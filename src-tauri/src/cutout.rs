//! Apple's own subject lifting for the background remover: Vision's
//! `VNGenerateForegroundInstanceMaskRequest`, the request behind "Copy
//! Subject" in Photos, on macOS 14 and later.
//!
//! It is the page's first look at a picture on a Mac, not its final answer.
//! Measured on 60 test pictures (November 2026) it took 0.04 s a picture on an
//! M1 Pro, about 50 times quicker than BiRefNet on the GPU, and nothing to
//! download; it also kept less of the right area (0.93 against 0.99 on
//! portraits, 0.39 against 0.92 on objects). So the page shows this mask at
//! once and swaps in the model's when that is ready, and uses this one alone
//! when the model is not on the computer yet.
//!
//! The page sends raw RGBA (one picture, at most `MAX_SIDE` on its long side)
//! as the request body with its size in two headers, and gets back the width
//! and height (u32, little endian) followed by one mask byte per pixel. Editor
//! windows only, as for Capture.

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Runtime;

/// Longest side the page sends. Vision works on a much smaller copy itself, and
/// the page refines the mask on the full size photo.
const MAX_SIDE: usize = 4096;

fn header(request: &Request<'_>, name: &str) -> Result<usize, String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .ok_or_else(|| format!("The cut-out request is missing {name}"))
}

/// Whether this Mac has Apple's subject lifting (macOS 14 and later).
#[tauri::command]
pub fn abs_cutout_vision_available<R: Runtime>(window: tauri::Window<R>) -> bool {
    crate::settings::is_editor_window(window.label()) && imp::available()
}

#[tauri::command]
pub async fn abs_cutout_vision<R: Runtime>(
    window: tauri::Window<R>,
    request: Request<'_>,
) -> Result<Response, String> {
    if !crate::settings::is_editor_window(window.label()) {
        return Err("Only an editor window can cut out a picture".into());
    }
    let width = header(&request, "x-osg-width")?;
    let height = header(&request, "x-osg-height")?;
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
        return Err(format!(
            "A picture of {width} by {height} pixels cannot be cut out here"
        ));
    }
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("The cut-out request carried no picture".into());
    };
    if bytes.len() != width * height * 4 {
        return Err("The picture's size does not match its pixels".into());
    }
    let rgba = bytes.clone();
    let mask =
        tauri::async_runtime::spawn_blocking(move || imp::subject_mask(&rgba, width, height))
            .await
            .map_err(|error| error.to_string())??;
    let mut out = Vec::with_capacity(8 + mask.len());
    out.extend_from_slice(&(width as u32).to_le_bytes());
    out.extend_from_slice(&(height as u32).to_le_bytes());
    out.extend_from_slice(&mask);
    Ok(Response::new(out))
}

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::AnyClass;
    use objc2::AnyThread;
    use objc2_core_foundation::CFData;
    use objc2_core_graphics::{
        CGBitmapInfo, CGColorRenderingIntent, CGColorSpace, CGDataProvider, CGImage,
        CGImageAlphaInfo,
    };
    use objc2_core_video::{
        kCVPixelFormatType_OneComponent32Float, CVPixelBufferGetBaseAddress,
        CVPixelBufferGetBytesPerRow, CVPixelBufferGetHeight, CVPixelBufferGetPixelFormatType,
        CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags,
        CVPixelBufferUnlockBaseAddress,
    };
    use objc2_foundation::{NSArray, NSDictionary};
    use objc2_vision::{VNGenerateForegroundInstanceMaskRequest, VNImageRequestHandler, VNRequest};

    pub fn available() -> bool {
        AnyClass::get(c"VNGenerateForegroundInstanceMaskRequest").is_some()
    }

    pub fn subject_mask(rgba: &[u8], width: usize, height: usize) -> Result<Vec<u8>, String> {
        if !available() {
            return Err("Apple's subject cut-out needs macOS 14 or later".into());
        }
        let data = CFData::from_bytes(rgba);
        let provider = CGDataProvider::with_cf_data(Some(&data))
            .ok_or("The picture could not be handed to Vision")?;
        let space = CGColorSpace::new_device_rgb().ok_or("No colour space for the picture")?;
        // SAFETY: the provider holds width * height * 4 bytes, which is what
        // 8 bits a channel, 32 a pixel and width * 4 a row describe; decode is null.
        let image = unsafe {
            CGImage::new(
                width,
                height,
                8,
                32,
                width * 4,
                Some(&space),
                CGBitmapInfo(CGImageAlphaInfo::NoneSkipLast.0),
                Some(&provider),
                std::ptr::null(),
                false,
                CGColorRenderingIntent::RenderingIntentDefault,
            )
        }
        .ok_or("The picture could not be read")?;

        let options = NSDictionary::new();
        // SAFETY: an empty options dictionary is valid for any image.
        let handler = unsafe {
            VNImageRequestHandler::initWithCGImage_options(
                VNImageRequestHandler::alloc(),
                &image,
                &options,
            )
        };
        // SAFETY: plain construction of a request with no completion handler.
        let request = unsafe { VNGenerateForegroundInstanceMaskRequest::new() };
        let as_request: Retained<VNRequest> =
            Retained::into_super(Retained::into_super(request.clone()));
        handler
            .performRequests_error(&NSArray::from_retained_slice(&[as_request]))
            .map_err(|error| {
                format!(
                    "Vision could not look at the picture: {}",
                    error.localizedDescription()
                )
            })?;

        // SAFETY: results are read after performRequests returned.
        let Some(observation) =
            (unsafe { request.results() }).and_then(|results| results.firstObject())
        else {
            // Vision found no subject: an empty mask, and the page says so.
            return Ok(vec![0; width * height]);
        };
        // SAFETY: the observation came from this handler's request.
        let instances = unsafe { observation.allInstances() };
        let buffer = unsafe {
            observation.generateScaledMaskForImageForInstances_fromRequestHandler_error(
                &instances, &handler,
            )
        }
        .map_err(|error| {
            format!(
                "Vision could not draw the mask: {}",
                error.localizedDescription()
            )
        })?;

        if CVPixelBufferGetPixelFormatType(&buffer) != kCVPixelFormatType_OneComponent32Float {
            return Err("Vision answered with a mask in an unknown format".into());
        }
        // SAFETY: locked read only and unlocked before the buffer is dropped.
        if unsafe { CVPixelBufferLockBaseAddress(&buffer, CVPixelBufferLockFlags::ReadOnly) } != 0 {
            return Err("Vision's mask could not be read".into());
        }
        let mask_width = CVPixelBufferGetWidth(&buffer);
        let mask_height = CVPixelBufferGetHeight(&buffer);
        let row_bytes = CVPixelBufferGetBytesPerRow(&buffer);
        let base = CVPixelBufferGetBaseAddress(&buffer) as *const u8;
        let mut out = vec![0u8; width * height];
        if !base.is_null() && mask_width == width && mask_height == height {
            for y in 0..height {
                // SAFETY: each row holds at least width f32 values, row_bytes apart.
                let row = unsafe {
                    std::slice::from_raw_parts(base.add(y * row_bytes) as *const f32, width)
                };
                for (x, value) in row.iter().enumerate() {
                    out[y * width + x] = (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                }
            }
        }
        unsafe { CVPixelBufferUnlockBaseAddress(&buffer, CVPixelBufferLockFlags::ReadOnly) };
        if mask_width != width || mask_height != height {
            return Err("Vision's mask came back at another size".into());
        }
        Ok(out)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    /// Vision on a real portrait, scored against its true mask. Needs a photo
    /// as raw RGBA named `<anything>_<width>x<height>.rgba` in
    /// OSG_VISION_FIXTURE, with the mask beside it (same name, `.mask`, one
    /// byte a pixel), so it runs on a Mac where someone gave it one and is
    /// skipped everywhere else.
    #[test]
    fn vision_cuts_a_portrait_out() {
        let Ok(path) = std::env::var("OSG_VISION_FIXTURE") else {
            return;
        };
        if !super::imp::available() {
            return;
        }
        let size = path
            .rsplit('_')
            .next()
            .unwrap()
            .trim_end_matches(".rgba")
            .to_string();
        let (w, h) = size.split_once('x').unwrap();
        let (width, height): (usize, usize) = (w.parse().unwrap(), h.parse().unwrap());
        let rgba = std::fs::read(&path).unwrap();
        let truth = std::fs::read(path.replace(".rgba", ".mask")).unwrap();
        let started = std::time::Instant::now();
        let mask = super::imp::subject_mask(&rgba, width, height).unwrap();
        let elapsed = started.elapsed();
        assert_eq!(mask.len(), width * height);
        let (mut inter, mut union) = (0usize, 0usize);
        for (m, t) in mask.iter().zip(truth.iter()) {
            let (m, t) = (*m > 127, *t > 127);
            inter += (m && t) as usize;
            union += (m || t) as usize;
        }
        let iou = inter as f64 / union.max(1) as f64;
        println!("vision: iou {iou:.3} in {elapsed:?}");
        assert!(iou > 0.9, "Vision kept {iou:.3} of the portrait");
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn available() -> bool {
        false
    }

    pub fn subject_mask(_rgba: &[u8], _width: usize, _height: usize) -> Result<Vec<u8>, String> {
        Err("Apple's subject cut-out is only on a Mac".into())
    }
}
