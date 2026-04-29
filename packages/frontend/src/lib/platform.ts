const PLATFORM_CLASSES = ['windows', 'linux', 'macos'] as const;

type Platform = (typeof PLATFORM_CLASSES)[number];

interface NavigatorWithUserAgentData extends Navigator {
  readonly userAgentData?: {
    readonly platform?: string;
  };
}

function getNavigatorPlatform(): string {
  if (typeof navigator === 'undefined') {
    return '';
  }

  const navigatorWithUserAgentData = navigator as NavigatorWithUserAgentData;
  return navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform ?? '';
}

function detectPlatform(): Platform | null {
  const platformSource =
    `${getNavigatorPlatform()} ${typeof navigator === 'undefined' ? '' : navigator.userAgent}`.toLowerCase();

  if (platformSource.includes('win')) {
    return 'windows';
  }

  if (platformSource.includes('mac')) {
    return 'macos';
  }

  if (platformSource.includes('linux')) {
    return 'linux';
  }

  return null;
}

function detectElectron(): boolean {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) {
    return true;
  }

  if (typeof window !== 'undefined' && 'electron' in window) {
    return true;
  }

  return false;
}

const platform = detectPlatform();
const isElectron = detectElectron();

function syncDocumentPlatformClass(): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.classList.remove(...PLATFORM_CLASSES);

  if (platform !== null) {
    document.documentElement.classList.add(platform);
  }
}

export { isElectron, platform, syncDocumentPlatformClass };
export type { Platform };
