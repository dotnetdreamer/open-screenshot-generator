import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setEntryPoint("src/index.ts");
// three.js needs a real GPU context; the default software renderer hangs.
Config.setChromiumOpenGlRenderer("angle");
