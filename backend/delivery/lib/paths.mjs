// Where things live. The scripts sit in backend/delivery; everything they generate (ledgers, caches, analyses, run state)
// goes to backend/data/delivery, which git ignores (backend/data/.gitignore). Override with NGK_DATA_DIR.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DELIVERY_DIR = path.resolve(HERE, '..');
export const DATA_DIR = process.env.NGK_DATA_DIR ? path.resolve(process.env.NGK_DATA_DIR) : path.resolve(DELIVERY_DIR, '..', 'data', 'delivery');
export const CONFIG_FILE = path.join(DELIVERY_DIR, 'config.json');
export const BACKEND_ENV_FILE = path.resolve(DELIVERY_DIR, '..', '.env');
