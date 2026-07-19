import { geocodingTool } from '../tools/geocodingTool.js';
import { weatherTool } from '../tools/weatherTool.js';

const toolRegistry = new Map([
  [geocodingTool.name, geocodingTool],
  [weatherTool.name, weatherTool],
]);

export function getToolByName(name) {
  return toolRegistry.get(name);
}