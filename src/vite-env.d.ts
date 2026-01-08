/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_TAGLINE: string;
  readonly VITE_API_ENDPOINT: string;
  readonly VITE_AWS_REGION: string;
  readonly VITE_STORAGE_URL: string;
  readonly VITE_USE_AUTH: string;
  readonly VITE_ENABLE_ADMIN: string;
  readonly VITE_ENABLE_RATINGS: string;
  readonly VITE_IMAGE_BASE_URL: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

