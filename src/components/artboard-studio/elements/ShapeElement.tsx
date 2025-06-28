"use client";
import type React from 'react';
import type { ShapeElementProps as ShapeElementType } from '@/types/artboard';

interface ShapeElementProps {
  element: ShapeElementType;
}

export function ShapeElement({ element }: ShapeElementProps) {
  // Fix stroke width calculation to ensure it's properly applied
  const strokeWidth = element.strokeWidth > 0 ? element.strokeWidth : 0;
  const { shapeType, fillColor, strokeColor, size, scale } = element;
  const scaledWidth = size.width * scale;
  const scaledHeight = size.height * scale;

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
            backgroundColor: element.fillColor,
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
                backgroundColor: fillColor,
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
                backgroundColor: fillColor,
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
            borderBottom: `${scaledHeight}px solid ${fillColor}`,
            // For stroke, this gets complex with CSS triangles.
            // A common approach is to use an outer, slightly larger triangle.
            // For simplicity, stroke is not fully implemented here for triangles.
          }}
        />
      )}

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
              {/* Use a single path with fill-rule to create the ring effect */}
              <path
                d={`
                  M 50 0 L 100 50 L 50 100 L 0 50 Z
                  M 50 ${50 - (40 * element.innerRadius / 100)} 
                  L ${50 - (40 * element.innerRadius / 100)} 50 
                  L 50 ${50 + (40 * element.innerRadius / 100)} 
                  L ${50 + (40 * element.innerRadius / 100)} 50 Z
                `}
                fill={fillColor}
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
                backgroundColor: fillColor,
                border: strokeWidth > 0 ? `${strokeWidth}px solid ${strokeColor}` : 'none',
                clipPath: getClipPath(),
              }}
            />
          )}
        </>
      )}

      {/* Fallback for unsupported shapes */}
      {!['rectangle', 'circle', 'triangle', 'message', 'speech-bubble', 'star', 'hexagon', 'pentagon', 'diamond', 'custom-polygon'].includes(element.shapeType) && (
        <div style={commonStyles}>Unsupported shape</div>
      )}
    </div>
  );
}
