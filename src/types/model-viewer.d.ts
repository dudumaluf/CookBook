/**
 * Ambient JSX type declaration for the `<model-viewer>` web component
 * (`@google/model-viewer`). The component is registered at runtime via the
 * dynamic import in `node-fal-hunyuan-3d.tsx`; this just teaches TypeScript
 * to accept the element + the props we use.
 *
 * Limited surface — extend if/when other 3D nodes need more attributes.
 */

import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          poster?: string;
          "camera-controls"?: boolean | "";
          "disable-pan"?: boolean | "";
          "disable-zoom"?: boolean | "";
          "auto-rotate"?: boolean | "";
          "rotation-per-second"?: string;
          "interaction-prompt"?: "auto" | "when-focused" | "none";
          exposure?: string | number;
          "shadow-intensity"?: string | number;
          "environment-image"?: string;
          "skybox-image"?: string;
          "tone-mapping"?: string;
          "camera-orbit"?: string;
          "min-camera-orbit"?: string;
          "max-camera-orbit"?: string;
          "field-of-view"?: string;
          ar?: boolean | "";
        },
        HTMLElement
      >;
    }
  }
}
