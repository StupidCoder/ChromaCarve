import { migrateFill, PROJECT_SCHEMA_VERSION, type Project } from '../state/store';

/** Download the project settings as JSON (binary assets are referenced by name only). */
export function exportProjectJson(project: Project, filename = 'chromacarve-project.json') {
  const data = JSON.stringify({ version: PROJECT_SCHEMA_VERSION, project }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parse a settings JSON file back into a Project. Accepts both the wrapped
 * `{ version, project }` form and a bare project object. Asset binaries are not
 * restored here; the user re-uploads files (re-linked by their filename).
 */
export async function importProjectJson(file: File): Promise<Project> {
  const obj = JSON.parse(await file.text());
  const project = (obj?.project ?? obj) as Project;
  if (!project?.output || !project?.background || !project?.border || !project?.foreground) {
    throw new Error('Not a valid ChromaCarve project file.');
  }
  // Migrate legacy fills (2D marble/noise -> volumetric stone/solid, wood
  // microReliefAmount -> microRelief) everywhere a Fill can appear.
  project.background.solidFill = migrateFill(project.background.solidFill);
  project.background.model.fill = migrateFill(project.background.model.fill);
  project.border.fill = migrateFill(project.border.fill);
  project.foreground.model.fill = migrateFill(project.foreground.model.fill);
  return project;
}
