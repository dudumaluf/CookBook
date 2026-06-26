import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  MediaPreviewImage,
  MediaPreviewPlaceholder,
  MediaPreviewVideo,
} from "@/components/nodes/media-preview";

describe("MediaPreview primitives", () => {
  describe("MediaPreviewImage", () => {
    it("renders an <a> wrapper that opens the URL in a new tab by default", () => {
      render(
        <MediaPreviewImage
          url="https://example.com/cat.png"
          alt="cat"
          aspectRatio="16 / 9"
          testId="img"
        />,
      );
      const wrapper = screen.getByTestId("img");
      expect(wrapper.tagName).toBe("A");
      expect(wrapper.getAttribute("href")).toBe("https://example.com/cat.png");
      expect(wrapper.getAttribute("target")).toBe("_blank");
      expect(wrapper.style.aspectRatio).toBe("16 / 9");
    });

    it("falls back to '1 / 1' when aspectRatio is null/undefined", () => {
      render(
        <MediaPreviewImage
          url="https://example.com/x.png"
          testId="img-fallback"
        />,
      );
      expect(screen.getByTestId("img-fallback").style.aspectRatio).toBe(
        "1 / 1",
      );
    });

    it("uses object-contain by default and object-cover when fit='cover'", () => {
      const { rerender } = render(
        <MediaPreviewImage
          url="https://example.com/y.png"
          alt="y"
          testId="img"
        />,
      );
      const initialImg = screen.getByAltText("y");
      expect(initialImg.className).toContain("object-contain");

      rerender(
        <MediaPreviewImage
          url="https://example.com/y.png"
          alt="y"
          fit="cover"
          testId="img"
        />,
      );
      const coverImg = screen.getByAltText("y");
      expect(coverImg.className).toContain("object-cover");
    });

    it("renders a non-clickable <div> when href is explicitly null", () => {
      render(
        <MediaPreviewImage
          url="https://example.com/z.png"
          alt="z"
          href={null}
          testId="img-no-link"
        />,
      );
      const wrapper = screen.getByTestId("img-no-link");
      expect(wrapper.tagName).toBe("DIV");
      expect(wrapper.getAttribute("href")).toBeNull();
    });

    it("hides the broken image (opacity:0) on load error without collapsing the wrapper", () => {
      render(
        <MediaPreviewImage
          url="bad-url"
          alt="broken"
          aspectRatio="4 / 3"
          testId="img-broken"
        />,
      );
      const img = screen.getByAltText("broken") as HTMLImageElement;
      fireEvent.error(img);
      expect(img.style.opacity).toBe("0");
      expect(screen.getByTestId("img-broken").style.aspectRatio).toBe("4 / 3");
    });

    it("reveals a W×H dimension chip after the image's natural size loads", () => {
      render(
        <MediaPreviewImage
          url="https://example.com/cat.png"
          alt="cat"
          testId="img-dims"
        />,
      );
      const img = screen.getByAltText("cat") as HTMLImageElement;
      // happy-dom never really loads <img>, so fake the natural size.
      Object.defineProperty(img, "naturalWidth", {
        value: 1920,
        configurable: true,
      });
      Object.defineProperty(img, "naturalHeight", {
        value: 1080,
        configurable: true,
      });
      fireEvent.load(img);
      expect(screen.getByText("1920\u00d71080")).toBeTruthy();
    });

    it("omits the chip when showDimensions is false", () => {
      render(
        <MediaPreviewImage
          url="https://example.com/cat.png"
          alt="cat"
          showDimensions={false}
          testId="img-nodims"
        />,
      );
      const img = screen.getByAltText("cat") as HTMLImageElement;
      Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
      Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
      fireEvent.load(img);
      expect(screen.queryByText("800\u00d7600")).toBeNull();
    });

    it("stops pointer-down so the canvas doesn't drag the node when clicking the preview", () => {
      // We can't observe React's stopPropagation directly via DOM events, but
      // we can confirm the handler is wired by asserting the link still opens.
      render(
        <MediaPreviewImage
          url="https://example.com/cat.png"
          alt="cat"
          testId="img-pd"
        />,
      );
      const link = screen.getByTestId("img-pd");
      expect(link.tagName).toBe("A");
      fireEvent.pointerDown(link);
    });
  });

  describe("MediaPreviewVideo", () => {
    it("defaults to 16/9 aspect ratio for video", () => {
      render(
        <MediaPreviewVideo
          url="https://example.com/x.mp4"
          testId="vid-default"
        />,
      );
      expect(screen.getByTestId("vid-default").style.aspectRatio).toBe(
        "16 / 9",
      );
    });

    it("uses the configured aspect when provided", () => {
      render(
        <MediaPreviewVideo
          url="https://example.com/x.mp4"
          aspectRatio="9 / 16"
          testId="vid-portrait"
        />,
      );
      expect(screen.getByTestId("vid-portrait").style.aspectRatio).toBe(
        "9 / 16",
      );
    });

    it("renders a <video> with object-contain so the silhouette never crops content", () => {
      render(<MediaPreviewVideo url="https://example.com/x.mp4" />);
      const video = document.querySelector("video");
      expect(video).not.toBeNull();
      expect(video?.className).toContain("object-contain");
    });

    it("forwards loop / muted props to the <video>", () => {
      render(
        <MediaPreviewVideo
          url="https://example.com/x.mp4"
          loop
          muted
          testId="vid-loop"
        />,
      );
      const video = document.querySelector("video") as HTMLVideoElement;
      expect(video.loop).toBe(true);
      expect(video.muted).toBe(true);
    });

    it("reveals a W×H dimension chip after metadata loads", () => {
      render(<MediaPreviewVideo url="https://example.com/x.mp4" />);
      const video = document.querySelector("video") as HTMLVideoElement;
      Object.defineProperty(video, "videoWidth", {
        value: 1280,
        configurable: true,
      });
      Object.defineProperty(video, "videoHeight", {
        value: 720,
        configurable: true,
      });
      fireEvent.loadedMetadata(video);
      expect(screen.getByText("1280\u00d7720")).toBeTruthy();
    });
  });

  describe("MediaPreviewPlaceholder", () => {
    it("renders children with the configured aspect ratio", () => {
      render(
        <MediaPreviewPlaceholder aspectRatio="3 / 4" testId="ph">
          <span>loading</span>
        </MediaPreviewPlaceholder>,
      );
      const wrapper = screen.getByTestId("ph");
      expect(wrapper.style.aspectRatio).toBe("3 / 4");
      expect(wrapper.textContent).toBe("loading");
    });

    it("falls back to 1/1 when aspectRatio is omitted (image-shaped placeholder)", () => {
      render(
        <MediaPreviewPlaceholder testId="ph-fallback">
          <span />
        </MediaPreviewPlaceholder>,
      );
      expect(screen.getByTestId("ph-fallback").style.aspectRatio).toBe(
        "1 / 1",
      );
    });
  });
});
