import { ArtboardState, Project } from '@/types/artboard';

// Function to load all available project files from data/projects folder
export async function loadProjectTemplates(): Promise<Project[]> {
  const projects: Project[] = [];
  
  try {
    // Load known project files from the data/projects directory
    const projectFiles = [
      'dukans.json'
    ];
    
    for (const filename of projectFiles) {
      try {
        const response = await fetch(`/data/projects/${filename}`);
        if (!response.ok) {
          console.warn(`Failed to load project from ${filename}`);
          continue;
        }
        
        const projectData = await response.json();
        
        // Extract filename without extension for display name
        const displayName = filename.replace('.json', '').charAt(0).toUpperCase() + filename.replace('.json', '').slice(1);
        
        // Use project data directly - structure it as Project interface
        const project: Project = {
          id: `template_${filename.replace('.json', '')}`, // Keep template prefix to differentiate
          name: displayName,
          description: `${displayName} project template`,
          previewImage: `https://placehold.co/300x200/6366f1/FFFFFF?text=${encodeURIComponent(displayName)}`,
          timestamp: new Date(), // Current time as template load time
          projectData: Array.isArray(projectData) ? projectData : (projectData.projectData || [])
        };
        
        projects.push(project);
      } catch (error) {
        console.error(`Error loading project from ${filename}:`, error);
      }
    }
  } catch (error) {
    console.error('Error loading project templates:', error);
  }
  
  return projects;
}

// Function to get all available project files (this would be enhanced to read directory dynamically)
export function getAvailableProjectFiles(): string[] {
  // In a real implementation, this would read the directory contents
  // For now, return the known project files
  return [
    'dukans.json'
  ];
}

// Function to dynamically load a specific project file
export async function loadProjectFile(filename: string): Promise<any | null> {
  try {
    const response = await fetch(`/data/projects/${filename}`);
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
