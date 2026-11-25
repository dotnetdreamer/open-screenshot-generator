"use client";

// Director's way in on a phone. Phones get no activity bar (it starts at the
// md width), so the editor's sidebar carries the item, as it carries Discover,
// Account, Settings and About. A child of the sidebar, so it can close the
// sidebar's sheet before the view opens over the editor.

import { ClapperboardIcon } from 'lucide-react';
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';

export function DirectorSidebarItem({ onOpen }: { onOpen: () => void }) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarGroup className="px-2 pb-0 pt-2 group-data-[collapsible=icon]:px-1 md:hidden">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Director, turn a screen recording into an app video"
            className="w-full"
            onClick={() => {
              setOpenMobile(false);
              onOpen();
            }}
            data-testid="director-sidebar-item"
          >
            <ClapperboardIcon />
            <span className="group-data-[collapsible=icon]:hidden">Director</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
