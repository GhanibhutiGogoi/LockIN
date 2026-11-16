/** Synthetic providers and sample content are available only in an explicit demo build. */
export const DEMO_MODE = import.meta.env.MODE === 'demo';
export const DEVELOPER_TOOLS = import.meta.env.DEV || import.meta.env.VITE_SHOW_INTEGRATIONS === 'true';
