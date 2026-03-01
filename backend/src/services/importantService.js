import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMPORTANT_FILE = path.join(__dirname, '..', '..', 'data', 'important.json');

// Ensure data directory exists
const ensureDataDir = () => {
  const dataDir = path.dirname(IMPORTANT_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
};

// Load important flags from file
const loadImportantFlags = () => {
  ensureDataDir();
  try {
    if (fs.existsSync(IMPORTANT_FILE)) {
      const data = fs.readFileSync(IMPORTANT_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading important flags:', error);
  }
  return {};
};

// Save important flags to file
const saveImportantFlags = (flags) => {
  ensureDataDir();
  try {
    fs.writeFileSync(IMPORTANT_FILE, JSON.stringify(flags, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving important flags:', error);
    return false;
  }
};

/**
 * Get important flag for a specific issue
 * @param {string} issueKey - Issue key (e.g., 'NGK-82182')
 * @returns {boolean} - True if important, false otherwise
 */
export const getIssueImportant = (issueKey) => {
  const flags = loadImportantFlags();
  return flags[issueKey] === true;
};

/**
 * Set important flag for a specific issue
 * @param {string} issueKey - Issue key
 * @param {boolean} important - Important flag value
 * @returns {boolean} - Success status
 */
export const setIssueImportant = (issueKey, important) => {
  const flags = loadImportantFlags();
  if (important) {
    flags[issueKey] = true;
  } else {
    delete flags[issueKey];
  }
  return saveImportantFlags(flags);
};

/**
 * Get all important flags
 * @returns {Object} - Object with issueKey as key and boolean as value
 */
export const getAllImportantFlags = () => {
  return loadImportantFlags();
};
