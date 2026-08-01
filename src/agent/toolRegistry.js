import { geocodingTool } from '../tools/geocodingTool.js';
import { weatherByLocationTool } from '../tools/weatherByLocationTool.js';
import { weatherTool } from '../tools/weatherTool.js';

const toolRegistry = new Map([
  [weatherByLocationTool.name, weatherByLocationTool],
  [geocodingTool.name, geocodingTool],
  [weatherTool.name, weatherTool],
]);

export function getToolByName(name) {
  return toolRegistry.get(name);
}
