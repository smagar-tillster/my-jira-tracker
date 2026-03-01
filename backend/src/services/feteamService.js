import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FETEAM_FILE = path.join(__dirname, '../../data/feteam.json');

/**
 * Load FE Team data from JSON file
 */
function loadFETeamData() {
  try {
    if (!fs.existsSync(FETEAM_FILE)) {
      fs.writeFileSync(FETEAM_FILE, JSON.stringify({}), 'utf8');
      return {};
    }
    const data = fs.readFileSync(FETEAM_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading FE team data:', error);
    return {};
  }
}

/**
 * Save FE Team data to JSON file
 */
function saveFETeamData(data) {
  try {
    fs.writeFileSync(FETEAM_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving FE team data:', error);
    return false;
  }
}

/**
 * Get all FE Team members
 * @returns {string[]} Array of assignee names who are FE Team members
 */
export function getAllFETeamMembers() {
  const data = loadFETeamData();
  return Object.keys(data).filter(assignee => data[assignee] === true);
}

/**
 * Get FE Team membership flags as object
 * @returns {Record<string, boolean>} Object mapping assignee to membership status
 */
export function getAllFETeamFlags() {
  return loadFETeamData();
}

/**
 * Set FE Team membership for an assignee
 * @param {string} assignee - The assignee name
 * @param {boolean} isMember - Whether the assignee is a FE Team member
 */
export function setFETeamMember(assignee, isMember) {
  const data = loadFETeamData();
  
  if (isMember) {
    data[assignee] = true;
  } else {
    delete data[assignee];
  }
  
  saveFETeamData(data);
}

/**
 * Check if an assignee is a FE Team member
 * @param {string} assignee - The assignee name
 * @returns {boolean} True if the assignee is a FE Team member
 */
export function isFETeamMember(assignee) {
  const data = loadFETeamData();
  return data[assignee] === true;
}
