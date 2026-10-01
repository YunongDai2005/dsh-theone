import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
// WebGL needs a GL backend in headless Chrome; "angle" uses the GPU where one is available.
Config.setChromiumOpenGlRenderer('angle');
