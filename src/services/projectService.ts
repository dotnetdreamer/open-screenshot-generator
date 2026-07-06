import { ArtboardState, Project } from '@/types/artboard';

// Matches basePath in next.config.ts so template fetches work under a sub-path deploy.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Function to load all available project files from data/projects folder
export async function loadProjectTemplates(): Promise<Project[]> {
  const projects: Project[] = [];
  
  try {
    // Load known project files from the data/projects directory
    const projectFiles = [
      'darzi-studio.json',
      'beauty-glam.json',
      'castique-podcast.json',
      'inquira.json',
      'zyluxe-beauty.json',
      'nexmind.json',
      'endless-communities.json',
      'kicksy-sneakers.json',
      'endless-podcasts.json',
      'answerly-ai.json',
      'lumina-search.json',
      'streamio-movies.json',
      'readly-books.json',
      'luxe-glow.json',
      'cryptix.json',
      'feasto.json',
      'storybuzz-kids.json',
      'trackio-fitness.json',
      'streamio-binge.json',
      'roomora-home.json',
      'playverse-games.json',
      'voyago-travel.json',
      'finexa-crypto.json',
      'flixio-kids.json',
      'listenly-audio.json',
      'tripora-travel.json',
      'tunio-music.json',
      'coinly-crypto.json',
      'stockio-invest.json',
      'threadly-social.json',
      'beatforge-studio.json'
    ];
    
    for (const filename of projectFiles) {
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
    'darzi-studio.json',
    'beauty-glam.json',
    'castique-podcast.json',
    'inquira.json',
    'zyluxe-beauty.json',
    'nexmind.json',
    'endless-communities.json',
    'kicksy-sneakers.json',
    'endless-podcasts.json',
    'answerly-ai.json',
    'lumina-search.json',
    'streamio-movies.json',
    'readly-books.json',
    'luxe-glow.json',
    'cryptix.json',
    'feasto.json',
    'storybuzz-kids.json',
    'trackio-fitness.json',
    'streamio-binge.json',
    'roomora-home.json',
    'playverse-games.json',
    'voyago-travel.json',
    'finexa-crypto.json',
    'flixio-kids.json',
    'listenly-audio.json',
    'tripora-travel.json',
    'tunio-music.json',
    'coinly-crypto.json',
    'stockio-invest.json',
    'threadly-social.json',
    'beatforge-studio.json'
  ];
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
