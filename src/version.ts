declare const __APP_VERSION__: string;

export const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.1.0-dev";
