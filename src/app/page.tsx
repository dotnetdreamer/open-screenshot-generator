
"use client";
import { ArtboardStudioLayout } from "@/components/artboard-studio/ArtboardStudioLayout";
import { useEffect, useState } from "react";
import { db } from "@/database"; // Assuming your database file is named database.ts in the src directory

interface Project {
  id?: string;
  timestamp: Date;
  projectData: any; // Adjust type as needed
}

export default function HomePage() {
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);

  useEffect(() => {
    const fetchRecentProjects = async () => {
      const projects = await db.projects.orderBy("timestamp").reverse().toArray();
      setRecentProjects(projects);
    };

    fetchRecentProjects();
  }, []);

  return (
    <main className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <ArtboardStudioLayout />
      {/* New Section for Recent Projects */}
      <section className="p-4">
        <h2 className="text-xl font-bold mb-4">Recent projects</h2>
        {recentProjects.length > 0 ? (
          <ul>
            {recentProjects.map((project) => (
              <li key={project.id}>
                Project saved on: {project.timestamp.toLocaleString()}
              </li>
            ))}
          </ul>
        ) : (
          <p>No recent projects found.</p>
        )}
 </section>
    </main>
  );
}
