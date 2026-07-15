import { ArtboardState, Project } from '@/types/artboard';
import { TEMPLATE_CATEGORIES, ALL_TEMPLATE_FILES } from '@/lib/templateCategories';
import { BASE_PATH } from '@/lib/basePath';

// Function to load all available project files from data/projects folder.
// Iterates the TEMPLATE_CATEGORIES catalog so every returned Project is tagged
// with its `category` id; the Start-a-New-Project dialog groups them into tabs.
export async function loadProjectTemplates(
  onProgress?: (done: number, total: number) => void
): Promise<Project[]> {
  // Flatten the catalog into (category, filename) tasks so every template fetches
  // CONCURRENTLY. The previous nested for-loop awaited each fetch before starting
  // the next, so opening the picker meant ~57 sequential round-trips before the
  // gallery could paint. On a latency-bound network that serial waterfall is the
  // whole delay; Promise.all collapses it into a handful of parallel batches.
  const tasks = TEMPLATE_CATEGORIES.flatMap((category) =>
    category.files.map((filename) => ({ categoryId: category.id, filename }))
  );

  // Drive the startup progress bar: report each fetch as it settles. Kept off the
  // hot path (a single counter increment) so it never slows the parallel batch.
  let done = 0;
  const total = tasks.length;
  onProgress?.(0, total);
  const tick = () => onProgress?.(++done, total);

  const results = await Promise.all(
    tasks.map(async ({ categoryId, filename }): Promise<Project | null> => {
      try {
        const response = await fetch(`${BASE_PATH}/data/projects/${filename}`);
        if (!response.ok) {
          console.warn(`Failed to load project from ${filename}`);
          return null;
        }

        const projectData = await response.json();

        // Extract filename without extension for display name
        const baseName = filename.replace('.json', '');
        const displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

        // Use project data directly - structure it as Project interface.
        // Template files may declare their own name/description/previewImage; fall back to filename-derived values.
        const templateName = (!Array.isArray(projectData) && projectData.name) || displayName;
        return {
          id: `template_${baseName}`, // Keep template prefix to differentiate
          name: templateName,
          description: (!Array.isArray(projectData) && projectData.description) || `${templateName} project template`,
          previewImage: (!Array.isArray(projectData) && projectData.previewImage) || `https://placehold.co/300x200/6366f1/FFFFFF?text=${encodeURIComponent(templateName)}`,
          timestamp: new Date(), // Current time as template load time
          category: categoryId,
          projectData: Array.isArray(projectData) ? projectData : (projectData.projectData || [])
        };
      } catch (error) {
        console.error(`Error loading project from ${filename}:`, error);
        return null;
      } finally {
        tick();
      }
    })
  );

  // Promise.all preserves task order, so the gallery order still matches the
  // catalog; drop any files that failed to load.
  return results.filter((project): project is Project => project !== null);
}

// Every known template filename, flattened across all categories.
export function getAvailableProjectFiles(): string[] {
  return ALL_TEMPLATE_FILES;
}

// Function to dynamically load a specific project file
export async function loadProjectFile(filename: string): Promise<any | null> {
  try {
    const response = await fetch(`${BASE_PATH}/data/projects/${filename}`);
    if (!response.ok) {
      throw new Error(`Failed to load project file: ${filename}`);
    }
    
    const projectData = await response.json();
    return projectData;
  } catch (error) {
    console.error(`Error loading project file ${filename}:`, error);
    return null;
  }
}
