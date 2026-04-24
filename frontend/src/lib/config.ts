const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const API_BASE_URL = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? '/api');
export const STORAGE_KEY = 'medibuddy.current-user';
