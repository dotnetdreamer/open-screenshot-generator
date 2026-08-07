"use client";
import type React from 'react';
import type { ShapeElementProps as ShapeElementType } from '@/types/artboard';
import { useT } from '@/i18n';

interface ShapeElementProps {
  element: ShapeElementType;
}

export function ShapeElement({ element }: ShapeElementProps) {
  const t = useT();
  // Fix stroke width calculation to ensure it's properly applied
  const strokeWidth = element.strokeWidth > 0 ? element.strokeWidth : 0;
  const { shapeType, fillColor, strokeColor, size, scale } = element;
  const scaledWidth = size.width * scale;
  const scaledHeight = size.height * scale;
  
  // Apply fillOpacity to a colour (the shape's own alpha channel, separate
  // from element.opacity, which fades the layer including its stroke).
  const withFillOpacity = (color: string) => {
    if (!element.fillOpacity || element.fillOpacity === 1) {
      return color;
    }

    // Convert hex color to rgba if needed
    if (color.startsWith('#')) {
      const hex = color.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const b = parseInt(hex.substr(4, 2), 16);
      return `rgba(${r}, ${g}, ${b}, ${element.fillOpacity})`;
    }

    // If already in rgba format, replace the alpha value
    if (color.startsWith('rgba')) {
      return color.replace(/[\d\.]+\)$/g, `${element.fillOpacity})`);
    }

    // If in rgb format, convert to rgba
    if (color.startsWith('rgb')) {
      return color.replace('rgb', 'rgba').replace(')', `, ${element.fillOpacity})`);
    }

    return color;
  };

  const fillColorWithOpacity = withFillOpacity(fillColor);

  // Gradient fill. CSS-painted shapes (rectangle, circle, clip-path polygons)
  // take it as a background image; SVG-painted ones (library paths, the
  // diamond ring) need a <linearGradient> def, so both forms are derived here
  // from the same two stops.
  const gradient = element.fillGradient;
  const gradientStops = gradient && typeof gradient.color1 === 'string' && typeof gradient.color2 === 'string' && typeof gradient.angle === 'number'
    ? { from: withFillOpacity(gradient.color1), to: withFillOpacity(gradient.color2), angle: gradient.angle }
    : null;
  const gradientCss = gradientStops
    ? `linear-gradient(${gradientStops.angle}deg, ${gradientStops.from}, ${gradientStops.to})`
    : undefined;
  // Element ids come from template JSON and user projects, so they can hold
  // characters that are not legal in an SVG fragment id or that would break the
  // unquoted url(#...) reference. Escaping each one to _<hex>_ keeps the
  // mapping injective, so two different elements can never share a gradient.
  const gradientId = `shape-fill-${element.id.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`)}`;
  // SVG has no angle, only endpoints: project the CSS gradient angle (0deg =
  // upward, growing clockwise) onto the shape's bounding box.
  const gradientVector = gradientStops
    ? (() => {
        const rad = (gradientStops.angle * Math.PI) / 180;
        const dx = Math.sin(rad) / 2;
        const dy = Math.cos(rad) / 2;
        return { x1: 0.5 - dx, y1: 0.5 + dy, x2: 0.5 + dx, y2: 0.5 - dy };
      })()
    : null;
  // What to hand a `fill=` / `stroke=` attribute, and what to hand a
  // `background` — a gradient when there is one, the solid fill otherwise.
  const svgPaint = gradientStops ? `url(#${gradientId})` : fillColorWithOpacity;
  const cssFillBackground: React.CSSProperties = gradientCss
    ? { backgroundImage: gradientCss }
    : { backgroundColor: fillColorWithOpacity };

  const GradientDef = () =>
    gradientVector ? (
      <defs>
        <linearGradient id={gradientId} x1={gradientVector.x1} y1={gradientVector.y1} x2={gradientVector.x2} y2={gradientVector.y2}>
          <stop offset="0%" stopColor={gradientStops!.from} />
          <stop offset="100%" stopColor={gradientStops!.to} />
        </linearGradient>
      </defs>
    ) : null;

  const commonStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
  };

  // Get border radius values with defaults
  const getBorderRadius = () => {
    if (!element.borderRadius && element.borderRadiusType !== 'individual') {
      return undefined;
    }

    if (element.borderRadiusType === 'individual') {
      const tl = element.borderRadiusTopLeft ?? 0;
      const tr = element.borderRadiusTopRight ?? 0;
      const br = element.borderRadiusBottomRight ?? 0;
      const bl = element.borderRadiusBottomLeft ?? 0;
      return `${tl}px ${tr}px ${br}px ${bl}px`;
    }

    return typeof element.borderRadius === 'number' ? `${element.borderRadius}px` : element.borderRadius;
  };

  // Generate CSS clip path for various shapes
  const getClipPath = (): string | undefined => {
    if (element.clipPath) {
      return element.clipPath;
    }

    switch (element.shapeType) {
      case 'message':
        return 'polygon(0% 0%, 100% 0%, 100% 75%, 75% 75%, 75% 100%, 50% 75%, 0% 75%)';
      case 'speech-bubble':
        return 'polygon(0% 0%, 100% 0%, 100% 75%, 85% 75%, 70% 100%, 70% 75%, 0% 75%)';
      case 'star': {
        const points = element.customPoints || 5;
        return generateStarClipPath(points);
      }
      case 'hexagon':
        return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
      case 'pentagon':
        return 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)';
      case 'diamond':
        return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      case 'custom-polygon':
        return element.clipPath || 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      default:
        return undefined;
    }
  };

  // Generate star clip path with specified number of points
  const generateStarClipPath = (points: number): string => {
    const angleStep = 360 / points;
    const radius = 50;
    const innerRadius = radius / 2;
    const center = { x: 50, y: 50 };
    let coords = [];

    for (let i = 0; i < points * 2; i++) {
      const currentRadius = i % 2 === 0 ? radius : innerRadius;
      const angleRad = (i * angleStep / 2 - 90) * Math.PI / 180;
      const x = center.x + currentRadius * Math.cos(angleRad);
      const y = center.y + currentRadius * Math.sin(angleRad);
      coords.push(`${x}% ${y}%`);
    }

    return `polygon(${coords.join(', ')})`;
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent">
      {element.shapeType === 'rectangle' && (
        <div
          style={{
            width: '100%',
            height: '100%',
            ...cssFillBackground,
            border: strokeWidth > 0 ? `${strokeWidth}px solid ${element.strokeColor}` : 'none',
            borderRadius: getBorderRadius(),
          }}
        />
      )}
      {element.shapeType === 'circle' && (
        <>
          {(element.innerRadius && element.innerRadius > 0) ? (
            // Render circle with inner radius (ring/donut shape) using CSS mask
            <div
              style={{
                ...commonStyles,
                ...cssFillBackground,
                border: strokeWidth > 0 ? `${strokeWidth}px solid ${strokeColor}` : 'none',
                borderRadius: '50%',
                WebkitMask: `radial-gradient(circle at center, transparent ${element.innerRadius}%, black ${element.innerRadius + 1}%)`,
                mask: `radial-gradient(circle at center, transparent ${element.innerRadius}%, black ${element.innerRadius + 1}%)`,
              }}
            />
          ) : (
            // Render solid circle
            <div
              style={{
                ...commonStyles,
                ...cssFillBackground,
                border: strokeWidth > 0 ? `${strokeWidth}px solid ${strokeColor}` : 'none',
                borderRadius: '50%',
              }}
            />
          )}
        </>
      )}
      {element.shapeType === 'triangle' && (
        <div
          style={{
            ...commonStyles,
            width: 0,
            height: 0,
            backgroundColor: 'transparent', // Triangle color comes from borders
            borderLeft: `${scaledWidth / 2}px solid transparent`,
            borderRight: `${scaledWidth / 2}px solid transparent`,
            borderBottom: `${scaledHeight}px solid ${fillColorWithOpacity}`,
            // For stroke, this gets complex with CSS triangles.
            // A common approach is to use an outer, slightly larger triangle.
            // For simplicity, stroke is not fully implemented here for triangles.
          }}
        />
      )}

      {/* Complex library shapes rendered from SVG path data */}
      {element.shapeType === 'custom-svg' && element.customPath && (() => {
        const special = element.specialProps || {};
        const strokeOnly = !!special.strokeOnly;
        const effectiveStrokeWidth = strokeOnly
          ? (strokeWidth > 0 ? strokeWidth : (special.baseStrokeWidth ?? 4))
          : strokeWidth;
        return (
          <svg
            style={{ ...commonStyles, display: 'block', overflow: 'visible' }}
            viewBox={special.viewBox || '0 0 100 100'}
            preserveAspectRatio="none"
          >
            <GradientDef />
            <path
              d={element.customPath}
              fill={strokeOnly ? 'none' : svgPaint}
              fillRule={special.fillRule === 'evenodd' ? 'evenodd' : undefined}
              stroke={strokeOnly ? svgPaint : (strokeWidth > 0 ? strokeColor : 'none')}
              strokeWidth={effectiveStrokeWidth > 0 ? effectiveStrokeWidth : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        );
      })()}

      {/* Shapes using clip-path */}
      {['message', 'speech-bubble', 'star', 'hexagon', 'pentagon', 'diamond', 'custom-polygon'].includes(element.shapeType) && (
        <>
          {element.shapeType === 'diamond' && element.innerRadius != null && element.innerRadius > 0 ? (
            // Render diamond with inner radius using SVG with fill-rule
            <svg
              style={{
                ...commonStyles,
                overflow: 'visible',
              }}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <GradientDef />
              {/* Use a single path with fill-rule to create the ring effect */}
              <path
                d={`
                  M 50 0 L 100 50 L 50 100 L 0 50 Z
                  M 50 ${50 - (40 * element.innerRadius / 100)} 
                  L ${50 - (40 * element.innerRadius / 100)} 50 
                  L 50 ${50 + (40 * element.innerRadius / 100)} 
                  L ${50 + (40 * element.innerRadius / 100)} 50 Z
                `}
                fill={svgPaint}
                stroke={strokeWidth > 0 ? strokeColor : 'none'}
                strokeWidth={strokeWidth}
                vectorEffect="non-scaling-stroke"
                fillRule="evenodd"
              />
            </svg>
          ) : (
            // Render solid shape using clip-path
            <div
              style={{
                ...commonStyles,
                ...cssFillBackground,
                border: strokeWidth > 0 ? `${strokeWidth}px solid ${strokeColor}` : 'none',
                clipPath: getClipPath(),
              }}
            />
          )}
        </>
      )}

      {/* Fallback for unsupported shapes */}
      {!['rectangle', 'circle', 'triangle', 'message', 'speech-bubble', 'star', 'hexagon', 'pentagon', 'diamond', 'custom-polygon', 'custom-svg'].includes(element.shapeType) && (
        <div style={commonStyles}>{t('elements.unsupportedShape')}</div>
      )}
    </div>
  );
}
