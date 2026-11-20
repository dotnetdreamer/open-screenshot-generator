//! Locks on the folders an icon write changes, so two writes into the same
//! files take turns, whichever copy of the app runs them.
//!
//! The app's own locks (`WRITING` and the lock file in icon_export.rs) only
//! reach copies that share the app's data folder. The Mac App Store build
//! keeps its data in a sandbox container and the Microsoft Store build keeps
//! its data in its package's private folder, so neither shares a data folder
//! with the downloadable build. What every copy shares is the folders being
//! written, so these locks go on them:
//!
//! - macOS and Linux: `flock` on the folder itself. No file is made, and the
//!   system drops the lock when the process ends, however it ends.
//! - Windows: a folder can't be locked that way, so each folder gets a named
//!   mutex, named after the folder's volume and file number, in the global
//!   namespace, so a save by another user of the computer takes its turn too.
//!   Its DACL lets every signed-in user wait on it and release it, and every
//!   copy opens it asking for exactly that (`CreateMutexExW`): `CreateMutexW`
//!   asks for full access when the mutex exists already, which the DACL
//!   refuses. There is one name per folder and no other: a copy that can't
//!   open it doesn't write, rather than lock something else. Full-trust apps,
//!   the Store build included, share named objects. A mutex left behind by a
//!   process that died goes to the next one waiting.
//!
//! A write locks every folder that exists on the way from the picked folder
//! to each of its files, top down: shallower folders first, and folders at
//! one depth by their identity, the same order for every writer. It locks a
//! folder it finds on the way later (made by the save it waited for) and
//! each folder it makes itself before anything goes in it
//! (`FolderLocks::add`). So a write never puts a file in a folder it doesn't
//! hold. Two writes wait for each other only when they touch a folder in
//! common (a write into a project and one into its `ios` folder do), and
//! never in a circle: a folder taken after the first lot sits below one this
//! write holds, so any other write holding it picked it or a folder inside
//! it, and such a write waits for nothing above it.
//!
//! A folder that can't be locked (the app may not open it, or its drive has
//! no locks, like some network drives) stops the write before it changes
//! anything: without the lock nothing keeps another save out of it.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

/// The locks one write holds, until it's dropped.
pub struct FolderLocks {
    held: Vec<imp::Held>,
    ids: Vec<imp::Id>,
}

/// Why a folder couldn't be locked.
#[derive(Debug)]
pub enum LockError {
    /// Another write still held it when the time ran out.
    Busy,
    /// It can't be locked at all: it can't be opened, or its drive has no locks.
    Unavailable { folder: PathBuf, error: std::io::Error },
}

enum Hold {
    Held(imp::Held),
    Busy,
    Unavailable(std::io::Error),
}

/// Every folder that exists on the way from `root` down to each of `files`,
/// `root` included. The folders still to be made are locked as they're made.
pub fn folders_on_the_way(root: &Path, files: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut folders = Vec::new();
    for file in files {
        let mut at = file.parent();
        while let Some(folder) = at {
            if !folder.starts_with(root) || !seen.insert(folder.to_path_buf()) {
                break;
            }
            if folder.is_dir() {
                folders.push(folder.to_path_buf());
            }
            at = folder.parent();
        }
    }
    folders
}

/// Locks each of `folders`, waiting for another write that holds one until
/// `until`. On Windows the locks belong to this thread: the write has to run
/// on it and drop them here, which the type enforces.
pub fn hold_all(folders: &[PathBuf], until: Instant) -> Result<FolderLocks, LockError> {
    // One folder reached by two paths is one lock, and every writer takes its
    // locks top down, by depth and then identity, never by the path it used.
    let mut found: Vec<((usize, imp::Id), &PathBuf)> = Vec::with_capacity(folders.len());
    for folder in folders {
        found.push((order_of(folder)?, folder));
    }
    found.sort_by_key(|entry| entry.0);
    found.dedup_by(|a, b| a.0 .1 == b.0 .1);
    let mut locks = FolderLocks { held: Vec::with_capacity(found.len()), ids: Vec::with_capacity(found.len()) };
    for ((_, id), folder) in found {
        locks.take(folder, id, until)?;
    }
    Ok(locks)
}

/// Where a folder comes in the one order every writer locks in: its depth
/// once links are resolved, then its identity.
fn order_of(folder: &Path) -> Result<(usize, imp::Id), LockError> {
    let unavailable = |error| LockError::Unavailable { folder: folder.to_path_buf(), error };
    let real = folder.canonicalize().map_err(unavailable)?;
    let id = imp::id(&real).map_err(unavailable)?;
    Ok((real.components().count(), id))
}

/// `folders` sorted the way they're locked, top down, for adding to a write
/// that already holds the folders above them.
pub fn top_down(folders: &[PathBuf]) -> Vec<PathBuf> {
    let mut ordered: Vec<(usize, &PathBuf)> = folders
        .iter()
        .map(|folder| (folder.canonicalize().map(|real| real.components().count()).unwrap_or(usize::MAX), folder))
        .collect();
    ordered.sort_by_key(|entry| entry.0);
    ordered.into_iter().map(|(_, folder)| folder.clone()).collect()
}

impl FolderLocks {
    /// Locks one more folder, below one this write holds: one it just made, or
    /// one that appeared while it waited, before it puts anything in it.
    /// Another write may have picked that folder meanwhile, and then this one
    /// waits for it, up to `until`. A folder held already is a no-op.
    pub fn add(&mut self, folder: &Path, until: Instant) -> Result<(), LockError> {
        let id = imp::id(folder).map_err(|error| LockError::Unavailable { folder: folder.to_path_buf(), error })?;
        if self.ids.contains(&id) {
            return Ok(());
        }
        self.take(folder, id, until)
    }

    fn take(&mut self, folder: &Path, id: imp::Id, until: Instant) -> Result<(), LockError> {
        #[cfg(test)]
        if tests::unavailable(folder) {
            return Err(LockError::Unavailable { folder: folder.to_path_buf(), error: std::io::Error::from(std::io::ErrorKind::Unsupported) });
        }
        match imp::hold(folder, id, until) {
            Hold::Held(lock) => {
                self.held.push(lock);
                self.ids.push(id);
                Ok(())
            }
            Hold::Busy => Err(LockError::Busy),
            Hold::Unavailable(error) => Err(LockError::Unavailable { folder: folder.to_path_buf(), error }),
        }
    }
}

#[cfg(unix)]
mod imp {
    use super::Hold;
    use std::fs::{File, TryLockError};
    use std::os::unix::fs::MetadataExt;
    use std::path::Path;
    use std::time::{Duration, Instant};

    /// The device and inode: the folder itself, whatever path leads to it.
    pub type Id = (u64, u64);

    /// The open folder. Closing it releases the lock.
    pub struct Held(#[allow(dead_code)] File);

    pub fn id(folder: &Path) -> std::io::Result<Id> {
        let found = std::fs::metadata(folder)?;
        if !found.is_dir() {
            return Err(std::io::Error::new(std::io::ErrorKind::NotADirectory, "not a folder"));
        }
        Ok((found.dev(), found.ino()))
    }

    pub(super) fn hold(folder: &Path, id: Id, until: Instant) -> Hold {
        let opened = match File::open(folder) {
            Ok(opened) => opened,
            Err(e) => return Hold::Unavailable(e),
        };
        match opened.metadata() {
            Ok(found) if (found.dev(), found.ino()) == id => {}
            Ok(_) => return Hold::Unavailable(std::io::Error::other("the folder was swapped for another while it was being locked")),
            Err(e) => return Hold::Unavailable(e),
        }
        loop {
            match opened.try_lock() {
                Ok(()) => return Hold::Held(Held(opened)),
                Err(TryLockError::WouldBlock) if Instant::now() < until => std::thread::sleep(Duration::from_millis(50)),
                Err(TryLockError::WouldBlock) => return Hold::Busy,
                Err(TryLockError::Error(e)) => return Hold::Unavailable(e),
            }
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::Hold;
    use std::marker::PhantomData;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;
    use std::time::Instant;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL, WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
    use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_FLAG_BACKUP_SEMANTICS,
    };
    use windows::Win32::System::Threading::{CreateMutexExW, ReleaseMutex, WaitForSingleObject, MUTEX_MODIFY_STATE, SYNCHRONIZATION_SYNCHRONIZE};

    /// The volume serial number and file index: the folder itself.
    pub type Id = (u64, u64);

    /// An owned mutex. A mutex belongs to the thread that took it, so this
    /// can't move to another thread (the PhantomData makes it !Send).
    pub struct Held {
        mutex: HANDLE,
        _this_thread: PhantomData<*const ()>,
    }

    impl Drop for Held {
        fn drop(&mut self) {
            unsafe {
                let _ = ReleaseMutex(self.mutex);
                let _ = CloseHandle(self.mutex);
            }
        }
    }

    pub fn id(folder: &Path) -> std::io::Result<Id> {
        // A folder only opens with backup semantics.
        let opened = std::fs::OpenOptions::new().read(true).custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0).open(folder)?;
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(HANDLE(opened.as_raw_handle()), &mut info) }.map_err(std::io::Error::other)?;
        if info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY.0 == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::NotADirectory, "not a folder"));
        }
        Ok((u64::from(info.dwVolumeSerialNumber), (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow)))
    }

    /// What every copy asks of a folder's mutex, and all its DACL grants:
    /// waiting on it (SYNCHRONIZE) and releasing it (MUTEX_MODIFY_STATE).
    pub(super) const RIGHTS: u32 = SYNCHRONIZATION_SYNCHRONIZE.0 | MUTEX_MODIFY_STATE.0;

    /// The DACL: those rights for every signed-in user (Authenticated Users),
    /// and a low integrity label, so an elevated copy and a normal one can
    /// both open the mutex whichever made it.
    pub(super) const SDDL: PCWSTR = w!("D:(A;;0x00100001;;;AU)S:(ML;;NW;;;LW)");

    /// The folder's mutex, made or opened with `RIGHTS` only. There is no
    /// other name to fall back to: a copy that can't open this one must not
    /// write, because it would hold a different lock from everyone else.
    pub(super) fn mutex_for(id: Id) -> std::io::Result<HANDLE> {
        let name: Vec<u16> = format!("Global\\OpenScreenshotGenerator.IconFolder.{:x}.{:x}", id.0, id.1).encode_utf16().chain(std::iter::once(0)).collect();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(SDDL, SDDL_REVISION_1, &mut descriptor, None) }.map_err(std::io::Error::other)?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: false.into(),
        };
        let made = unsafe { CreateMutexExW(Some(&attributes), PCWSTR(name.as_ptr()), 0, RIGHTS) };
        unsafe {
            let _ = LocalFree(Some(HLOCAL(descriptor.0)));
        }
        made.map_err(std::io::Error::other)
    }

    pub(super) fn hold(_folder: &Path, id: Id, until: Instant) -> Hold {
        let mutex = match mutex_for(id) {
            Ok(mutex) => mutex,
            Err(e) => return Hold::Unavailable(e),
        };
        // u32::MAX would mean "forever".
        let wait = until.saturating_duration_since(Instant::now()).as_millis().min(u128::from(u32::MAX - 1)) as u32;
        let answer = unsafe { WaitForSingleObject(mutex, wait) };
        // WAIT_ABANDONED: the last owner died holding it, and it's this thread's now.
        if answer == WAIT_OBJECT_0 || answer == WAIT_ABANDONED {
            return Hold::Held(Held { mutex, _this_thread: PhantomData });
        }
        let failure = std::io::Error::last_os_error();
        unsafe {
            let _ = CloseHandle(mutex);
        }
        if answer == WAIT_TIMEOUT {
            Hold::Busy
        } else {
            Hold::Unavailable(failure)
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod imp {
    use super::Hold;
    use std::path::Path;
    use std::time::Instant;

    pub type Id = (u64, u64);
    pub struct Held;

    pub fn id(_folder: &Path) -> std::io::Result<Id> {
        Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
    }

    pub(super) fn hold(_folder: &Path, _id: Id, _until: Instant) -> Hold {
        Hold::Unavailable(std::io::Error::from(std::io::ErrorKind::Unsupported))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::path::{Path, PathBuf};

    thread_local! {
        static UNAVAILABLE: std::cell::RefCell<Vec<PathBuf>> = const { std::cell::RefCell::new(Vec::new()) };
    }

    /// Whether a test made this folder's lock unavailable, as on a drive with no locks.
    pub(super) fn unavailable(folder: &Path) -> bool {
        UNAVAILABLE.with(|all| all.borrow().iter().any(|path| path == folder))
    }

    /// Makes `folder`'s lock unavailable on this thread until the guard drops.
    pub struct NoLocksOn;
    impl NoLocksOn {
        pub fn folder(folder: &Path) -> NoLocksOn {
            UNAVAILABLE.with(|all| all.borrow_mut().push(folder.to_path_buf()));
            NoLocksOn
        }
    }
    impl Drop for NoLocksOn {
        fn drop(&mut self) {
            UNAVAILABLE.with(|all| all.borrow_mut().clear());
        }
    }

    /// Round 7's Windows defect: CreateMutexW asks for full access when the
    /// mutex exists, the DACL refused it, and the copy fell back to a second
    /// mutex of its own. Opened again, a held folder's mutex must be the same
    /// one, and held.
    #[cfg(windows)]
    #[test]
    fn a_folder_mutex_opened_again_is_the_same_held_lock() {
        use std::time::{Duration, Instant};
        let folder = std::env::temp_dir().join(format!("osg-folder-mutex-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let held = super::hold_all(std::slice::from_ref(&folder), Instant::now() + Duration::from_secs(5)).unwrap();
        let second = {
            let folder = folder.clone();
            std::thread::spawn(move || super::hold_all(&[folder], Instant::now() + Duration::from_millis(300)).err())
        };
        assert!(matches!(second.join().unwrap(), Some(super::LockError::Busy)), "the second open found the same mutex, held");
        drop(held);
        // Free again, it can be taken, with only the rights every copy asks for.
        let mutex = super::imp::mutex_for(super::imp::id(&folder).unwrap()).unwrap();
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(mutex);
        }
        assert!(super::hold_all(std::slice::from_ref(&folder), Instant::now() + Duration::from_secs(1)).is_ok());
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
