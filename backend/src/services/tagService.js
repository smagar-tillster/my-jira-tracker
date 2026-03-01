import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TAGS_FILE = path.join(__dirname, '..', '..', 'data', 'tags.json');

// Ensure data directory exists
const ensureDataDir = () => {
  const dataDir = path.dirname(TAGS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
};

// Load tags from file
const loadTags = () => {
  ensureDataDir();
  try {
    if (fs.existsSync(TAGS_FILE)) {
      const data = fs.readFileSync(TAGS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading tags:', error);
  }
  return {};
};

// Save tags to file
const saveTags = (tags) => {
  ensureDataDir();
  try {
    fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving tags:', error);
    return false;
  }
};

/**
 * Get tags for a specific issue
 * @param {string} issueKey - Issue key (e.g., 'NGK-82182')
 * @returns {Array} - Array of tags
 */
export const getIssueTags = (issueKey) => {
  const tags = loadTags();
  return tags[issueKey] || [];
};

/**
 * Get all tags
 * @returns {Object} - Object with issue keys as keys and tag arrays as values
 */
export const getAllTags = () => {
  return loadTags();
};

/**
 * Set tags for a specific issue
 * @param {string} issueKey - Issue key (e.g., 'NGK-82182')
 * @param {Array} tags - Array of tags
 * @returns {boolean} - Success status
 */
export const setIssueTags = (issueKey, tags) => {
  const allTags = loadTags();
  allTags[issueKey] = tags;
  return saveTags(allTags);
};

/**
 * Add a tag to an issue
 * @param {string} issueKey - Issue key
 * @param {string} tag - Tag to add
 * @returns {boolean} - Success status
 */
export const addIssueTag = (issueKey, tag) => {
  const allTags = loadTags();
  if (!allTags[issueKey]) {
    allTags[issueKey] = [];
  }
  if (!allTags[issueKey].includes(tag)) {
    allTags[issueKey].push(tag);
  }
  return saveTags(allTags);
};

/**
 * Remove a tag from an issue
 * @param {string} issueKey - Issue key
 * @param {string} tag - Tag to remove
 * @returns {boolean} - Success status
 */
export const removeIssueTag = (issueKey, tag) => {
  const allTags = loadTags();
  if (allTags[issueKey]) {
    allTags[issueKey] = allTags[issueKey].filter((t) => t !== tag);
  }
  return saveTags(allTags);
};

/**
 * Get all unique tags across all issues
 * @returns {Array} - Array of unique tags
 */
export const getAllUniqueTags = () => {
  const allTags = loadTags();
  const uniqueTags = new Set();
  Object.values(allTags).forEach((tags) => {
    tags.forEach((tag) => uniqueTags.add(tag));
  });
  return Array.from(uniqueTags).sort();
};
