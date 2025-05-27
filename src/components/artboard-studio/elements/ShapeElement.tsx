"use client";
import type React from 'react';
import type { ShapeElementProps as ShapeElementType } from '@/types/artboard';

interface ShapeElementProps {
  element: ShapeElementType;
}

export function ShapeElement({ element }: ShapeElementProps) {
  // Adjust stroke width to be visible at scale
  const adjustedStrokeWidth = element.strokeWidth > 0 ? Math.max(1, element.strokeWidth * 2) : 0;
  const { shapeType, fillColor, strokeColor, size, scale } = element;
  const scaledWidth = size.width * scale;
  const scaledHeight = size.height * scale;

  const commonStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent">
      {element.shapeType === 'rectangle' && (
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: element.fillColor,
            border: adjustedStrokeWidth > 0 ? `${adjustedStrokeWidth}px solid ${element.strokeColor}` : 'none',
          }}
        />
      )}
      {element.shapeType === 'circle' && (
        <div
          style={{
            ...commonStyles,
            backgroundColor: fillColor,
            border: `${adjustedStrokeWidth}px solid ${strokeColor}`,
            borderRadius: '50%',
          }}
        />
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
      {/* Add more shapes as needed */}
      {element.shapeType !== 'rectangle' && element.shapeType !== 'circle' && element.shapeType !== 'triangle' && (
        <div style={commonStyles}>Unsupported shape</div>
      )}
    </div>
  );
}
