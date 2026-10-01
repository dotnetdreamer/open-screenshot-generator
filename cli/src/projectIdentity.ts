/**
 * The id and name a project file is written back with.
 *
 * `osg edit` and `osg call --save` rebuild the file from the editor once the
 * tools have run. The file is the project, so it keeps its own id and name,
 * whatever the editor calls the document it holds. The editor's id and name
 * can differ from the file's for two reasons:
 *
 * - The file has no artboards, so the editor never opened it (it opens no
 *   document without one). The first artboard a tool adds then starts a
 *   project of the editor's own, with a generated id and a random name.
 * - A tool renamed the project: rename_project, or apply_template with a
 *   projectName.
 *
 * Only a rename belongs in the file. The id is what tells the two apart: a
 * rename changes the name of the project the editor already had.
 */

/** The editor's project, as the bridge's status() reports it. */
export interface EditorProject {
  projectId: string | null;
  projectName: string;
}

/** The id and name stored in a project file. */
export interface ProjectIdentity {
  id: string;
  name: string;
}

/**
 * The project a run follows, after one more tool call. While the editor keeps
 * the same project, it keeps the name it had when it arrived. A project the
 * editor moves to (the first artboard on an empty document, a template opened
 * as a new project) is followed from then on, with its own name. Null until
 * the editor has a project.
 */
export function followEditorProject(followed: EditorProject | null, now: EditorProject): EditorProject | null {
  if (now.projectId === null) return followed;
  if (followed && followed.projectId === now.projectId) return followed;
  return { projectId: now.projectId, projectName: now.projectName };
}

/**
 * What the file is written as. `followed` is the project the run followed,
 * the file's own when the editor opened it, and `now` is status() at the write.
 */
export function writeBackIdentity(
  file: ProjectIdentity,
  followed: EditorProject | null,
  now: EditorProject
): ProjectIdentity {
  const renamed =
    followed !== null &&
    now.projectId !== null &&
    now.projectId === followed.projectId &&
    now.projectName !== followed.projectName;
  return { id: file.id, name: renamed ? now.projectName : file.name };
}
