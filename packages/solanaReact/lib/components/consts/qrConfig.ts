import { Options } from 'qr-code-styling';

export const qrOptions: Partial<Options> = {
  data: 'sample',
  width: 2000,
  height: 2000,
  margin: 0,
  shape: 'square',
  type: 'canvas',
  backgroundOptions: {
    color: undefined,
  },
  cornersSquareOptions: {
    type: 'extra-rounded',
  },
  cornersDotOptions: {
    type: 'rounded',
  },
  qrOptions: {
    errorCorrectionLevel: 'M',
  },
  dotsOptions: {
    color: '#ffffff',
    type: 'extra-rounded',
  },
  image: 'https://dev.develop.alien.org/qr-logo.png',
  imageOptions: {
    imageSize: 0.6,
    crossOrigin: 'anonymous',
    margin: 50,
    hideBackgroundDots: true,
  },
};