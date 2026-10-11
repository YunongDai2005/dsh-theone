import { type EditableSettings } from './settings-types.ts';
/**
 * Validate the entire editable form before committing any settings. `fallback` fills keys added
 * after the form was saved whose default comes from the deployment (e.g. the catalog file).
 */
export declare function validateSettings(value: unknown, fallback?: Partial<EditableSettings>): EditableSettings;
