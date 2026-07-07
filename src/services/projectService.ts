import { ArtboardState, Project } from '@/types/artboard';
import { TEMPLATE_CATEGORIES, ALL_TEMPLATE_FILES } from '@/lib/templateCategories';

// Matches basePath in next.config.ts so template fetches work under a sub-path deploy.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Function to load all available project files from data/projects folder.
// Iterates the TEMPLATE_CATEGORIES catalog so every returned Project is tagged
// with its `category` id; the Start-a-New-Project dialog groups them into tabs.
export async function loadProjectTemplates(): Promise<Project[]> {
  const projects: Project[] = [];

  for (const category of TEMPLATE_CATEGORIES) {
    for (const filename of category.files) {
      try {
        const response = await fetch(`${BASE_PATH}/data/projects/${filename}`);
        if (!response.ok) {
          console.warn(`Failed to load project from ${filename}`);
          continue;
        }

        const projectData = await response.json();

        // Extract filename without extension for display name
        const displayName = filename.replace('.json', '').charAt(0).toUpperCase() + filename.replace('.json', '').slice(1);

        // Use project data directly - structure it as Project interface.
        // Template files may declare their own name/description/previewImage; fall back to filename-derived values.
        const templateName = (!Array.isArray(projectData) && projectData.name) || displayName;
        const project: Project = {
          id: `template_${filename.replace('.json', '')}`, // Keep template prefix to differentiate
          name: templateName,
          description: (!Array.isArray(projectData) && projectData.description) || `${templateName} project template`,
          previewImage: (!Array.isArray(projectData) && projectData.previewImage) || `https://placehold.co/300x200/6366f1/FFFFFF?text=${encodeURIComponent(templateName)}`,
          timestamp: new Date(), // Current time as template load time
          category: category.id,
          projectData: Array.isArray(projectData) ? projectData : (projectData.projectData || [])
        };

        projects.push(project);
      } catch (error) {
        console.error(`Error loading project from ${filename}:`, error);
      }
    }
  }

  return projects;
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
