const logoSvg = `<svg width="43" height="43" viewBox="0 0 43 43" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="21.0498" cy="21.0498" r="21.0498" fill="url(#paint0_linear_482_3577)"/><path d="M21.0508 8.68848C27.1332 8.68848 31.8125 13.6235 31.8125 19.6348C31.8125 22.743 31.536 24.8434 31.2861 26.1064C31.04 27.3504 30.2829 28.3259 29.3936 28.9971L25.2676 32.1104C24.0513 33.0282 22.7166 33.5713 21.0967 33.5713C19.4995 33.5713 18.0706 33.0435 16.834 32.1104L12.708 28.9971C11.8186 28.3259 11.0616 27.3504 10.8154 26.1064C10.5655 24.8434 10.2891 22.743 10.2891 19.6348C10.2891 13.6235 14.9684 8.68849 21.0508 8.68848Z" stroke="white" stroke-width="2.6628"/><path fill-rule="evenodd" clip-rule="evenodd" d="M18.8954 21.2769C20.3497 23.7943 20.3795 26.4982 18.9619 27.3161C17.5443 28.1341 15.2162 26.7564 13.7619 24.239C12.3076 21.7215 12.2778 19.0177 13.6954 18.1997C15.113 17.3818 17.4411 18.7595 18.8954 21.2769ZM22.9939 27.3161C21.5763 26.4982 21.6061 23.7943 23.0604 21.2769C24.5147 18.7595 26.8428 17.3818 28.2604 18.1997C29.678 19.0177 29.6482 21.7215 28.1939 24.239C26.7396 26.7564 24.4115 28.1341 22.9939 27.3161Z" fill="white"/><defs><linearGradient id="paint0_linear_482_3577" x1="21.0498" y1="0" x2="21.0498" y2="42.0997" gradientUnits="userSpaceOnUse"><stop stop-color="#2551FB"/><stop offset="1" stop-color="#26CDF7"/></linearGradient></defs></svg>`;

let _logoBlobUri: string | null = null;

/**
 * Returns a blob URL for the logo SVG.
 * Blob URLs are CSP-friendly (allowed by connect-src 'blob:').
 * Falls back to data URI if Blob is not available (SSR).
 */
export function getLogoUri(): string {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined') {
    // SSR fallback - return data URI
    return `data:image/svg+xml;utf8,${encodeURIComponent(logoSvg)}`;
  }

  if (_logoBlobUri === null) {
    const blob = new Blob([logoSvg], { type: 'image/svg+xml' });
    _logoBlobUri = URL.createObjectURL(blob);
  }

  return _logoBlobUri;
}
