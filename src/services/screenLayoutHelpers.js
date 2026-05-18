'use strict';

/**
 * Shared layout helpers used by both screenEvolutionService and
 * screenPredictionService. Extracted here to avoid circular imports.
 */

// Pixel-width → viewport size class (mirrors normalizerService._viewportClass)
function viewportClassFromWidth(width) {
  const w = Number(width) || 0;
  if (w <= 480)  return 'xs';
  if (w <= 768)  return 'sm';
  if (w <= 1024) return 'md';
  if (w <= 1440) return 'lg';
  return 'xl';
}

// Viewport size class → canonical representative pixel width
function viewportWidthFromClass(cls) {
  return { xs: 360, sm: 640, md: 900, lg: 1280, xl: 1920 }[cls] || 640;
}

// Pop one level off a slash-delimited context path
function popContext(ctx) {
  if (!ctx || ctx === 'home') return 'home';
  const parts = ctx.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : 'home';
}

// Default layout type for a given device + context
function defaultLayout(deviceType, context) {
  if (deviceType === 'wearable')       return 'stack';
  if (context === 'menu')              return 'drawer';
  if (context.startsWith('search:'))   return 'list';
  return 'stack';
}

// Minimal component scaffold for a given context
function defaultComponents(context) {
  if (context === 'menu') {
    return [
      { id: 'nav',   type: 'nav',  content: 'Navigation', order: 0 },
      { id: 'items', type: 'list', content: '',           order: 1 },
    ];
  }
  if (context.startsWith('search:')) {
    return [
      { id: 'bar',     type: 'input', content: context.slice(7), order: 0 },
      { id: 'results', type: 'list',  content: '',               order: 1 },
    ];
  }
  return [
    { id: 'header', type: 'text', content: context, order: 0 },
    { id: 'body',   type: 'card', content: '',      order: 1 },
  ];
}

module.exports = {
  viewportClassFromWidth,
  viewportWidthFromClass,
  popContext,
  defaultLayout,
  defaultComponents,
};
