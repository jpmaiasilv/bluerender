export interface GenerateRenderParams {
  prompt: string;
  /** Raw base64-encoded source image (no data: URI prefix). Omit for pure text-to-image. */
  imageBase64?: string;
  /** Optional second reference image (style/materials/lighting only), same encoding. */
  referenceImageBase64?: string;
  /**
   * The real MIME type of `imageBase64` / `referenceImageBase64`, as detected from the
   * uploaded file's own bytes. BFL's API is format-agnostic and ignores this; a provider
   * that uploads the image as a file part (e.g. OpenAI's images.edit) needs it.
   */
  imageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  referenceImageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Omit both to let the model pick its own default dimensions (text-to-image "automatic"). */
  width?: number;
  height?: number;
  outputFormat: 'png' | 'jpeg';
  /** Called with the provider's raw status string while polling (e.g. "Pending"). */
  onProviderStatus?: (status: string) => void;
}

export interface GenerateRenderResult {
  imageBuffer: Buffer;
  contentType: string;
  requestId: string;
  seed?: number;
}

export interface ProviderModel {
  id: string;
  label: string;
}

/**
 * Common interface every image-generation provider must implement.
 * Add a new provider by implementing this interface and registering it
 * in providers/registry.ts — no frontend changes required.
 */
export interface RenderProvider {
  id: string;
  label: string;
  models: ProviderModel[];
  generateRender(modelId: string, params: GenerateRenderParams): Promise<GenerateRenderResult>;
}
