import React from "react";
import type { DemoProps } from "./types";
import { AppIconDemo, HeaderArtDemo, RemoveBgDemo, SeoDemo, SocialDemo, WebsiteDemo } from "./ship";
import { BeforeAfterDemo, ComplianceDemo, CompetitorsDemo, GrowthDemo, KeywordsDemo, ReviewsDemo } from "./grow";
import { EditTogetherDemo, McpDemo, SecondScreenDemo, StorageDemo, UploadDemo, VersionsDemo } from "./work";

export type { DemoProps };

/** Each module's screen, in the order of FEATURES in copy.ts. */
export const DEMOS: React.FC<DemoProps>[] = [
  AppIconDemo,
  RemoveBgDemo,
  HeaderArtDemo,
  SocialDemo,
  WebsiteDemo,
  SeoDemo,
  GrowthDemo,
  BeforeAfterDemo,
  KeywordsDemo,
  CompetitorsDemo,
  ReviewsDemo,
  ComplianceDemo,
  EditTogetherDemo,
  VersionsDemo,
  StorageDemo,
  McpDemo,
  SecondScreenDemo,
  UploadDemo,
];
