export function getYouTubeEmbedUrl(url: string, defaultStartSeconds: number = 90) {
  try {
    let videoId = "";
    let startParam = `&start=${defaultStartSeconds}`;

    // Extract start parameter if present
    if (url.includes("start=")) {
      const match = url.match(/start=(\d+)/);
      if (match) {
        startParam = `&start=${match[1]}`;
      }
    } else if (url.includes("t=")) {
      const match = url.match(/t=(\d+)/);
      if (match) {
        startParam = `&start=${match[1]}`;
      }
    }

    if (url.includes("/live/")) {
      const parts = url.split("/live/");
      videoId = parts[1].split("?")[0];
    } else if (url.includes("v=")) {
      const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
      const match = url.match(regExp);
      if (match && match[2].length === 11) {
        videoId = match[2];
      }
    } else {
      const parts = url.split("/");
      const lastPart = parts[parts.length - 1].split("?")[0];
      if (lastPart.length === 11) {
        videoId = lastPart;
      }
    }

    if (videoId) {
      return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&iv_load_policy=3&loop=1&playlist=${videoId}${startParam}`;
    }
    return url;
  } catch {
    return url;
  }
}

export const CAMERA_POSITIONS = ["FRONT", "REAR", "LEFT", "RIGHT", "CABIN"] as const;