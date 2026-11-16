/**
 * Application & Environment Configuration
 * 
 * ----------------------------------------------------------------------------
 * 📍 TO CHANGE THE API BASE URL (e.g. Production):
 * Simply edit `backendUrl` below to your production URL.
 * Example:
 *   backendUrl: 'https://api.sepay.com'
 * ----------------------------------------------------------------------------
 */
export const config = {
  // Backend API Base URL
  backendUrl: 'https://sepay.stageserv.in',

  // Stripe Configuration (Loaded dynamically from backend /api/terminal_config)
  publishableKey: '',
  locationId: '',
  simulatedReader: false,
};

export default config;
