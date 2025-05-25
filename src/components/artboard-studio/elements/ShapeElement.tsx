
"use client";
import type React from 'react';
import type { ShapeElementProps as ShapeElementType } from '@/types/artboard';

interface ShapeElementProps {
  element: ShapeElementType;
}

export function ShapeElement({ element }: ShapeElementProps) {
  const { shapeType, fillColor, strokeColor, strokeWidth, size, scale } = element;
  const scaledWidth = size.width * scale;
  const scaledHeight = size.height * scale;

  const commonStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
  };

  if (shapeType === 'rectangle') {
    return (
      <div
        style={{
          ...commonStyles,
          backgroundColor: fillColor,
          border: `${strokeWidth}px solid ${strokeColor}`,
          borderRadius: '2px', // Slight rounding for a softer look
        }}
      />
    );
  }

  if (shapeType === 'circle') {
    return (
      <div
        style={{
          ...commonStyles,
          backgroundColor: fillColor,
          border: `${strokeWidth}px solid ${strokeColor}`,
          borderRadius: '50%',
        }}
      />
    );
  }
  
  if (shapeType === 'triangle') {
    // Basic CSS triangle. More complex triangles might need SVG.
    // This triangle points up. Adjust border styles for other orientations.
    // The "size" of the triangle is based on its bounding box.
    return (
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
    );
  }


  return <div style={commonStyles}>Unsupported shape</div>;
}
