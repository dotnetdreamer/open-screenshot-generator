"use client";

import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from '@/i18n';

interface DeleteArtboardDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirmDelete: () => void;
  artboardName: string;
  elementCount: number;
}

export function DeleteArtboardDialog({
  isOpen,
  onOpenChange,
  onConfirmDelete,
  artboardName,
  elementCount,
}: DeleteArtboardDialogProps) {
  const t = useT();
  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deleteArtboardDialog.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {elementCount === 1
              ? t('deleteArtboardDialog.descOne', { name: artboardName })
              : t('deleteArtboardDialog.descMany', { name: artboardName, count: elementCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirmDelete}
          >
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
