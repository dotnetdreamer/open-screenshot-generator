
"use client";
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { TargetStore, ExportDeviceCategory } from '@/types/artboard';

interface ExportDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirmExport: (store: TargetStore, deviceTypes: ExportDeviceCategory[]) => void;
}

export function ExportDialog({ isOpen, onOpenChange, onConfirmExport }: ExportDialogProps) {
  const [step, setStep] = useState<'storeSelection' | 'deviceSelection'>('storeSelection');
  const [selectedStore, setSelectedStore] = useState<TargetStore | null>(null);
  const [selectedDeviceTypes, setSelectedDeviceTypes] = useState<ExportDeviceCategory[]>([]);

  const googlePlayDevices: ExportDeviceCategory[] = ['Phone', 'Tablet'];
  const appStoreDevices: ExportDeviceCategory[] = ['iPhone', 'iPad'];

  useEffect(() => {
    // Reset state if dialog is reopened
    if (isOpen) {
      setStep('storeSelection');
      setSelectedStore(null);
      setSelectedDeviceTypes([]);
    }
  }, [isOpen]);

  const handleStoreSelect = (store: TargetStore) => {
    setSelectedStore(store);
  };

  const handleDeviceTypeToggle = (deviceType: ExportDeviceCategory) => {
    setSelectedDeviceTypes(prev =>
      prev.includes(deviceType)
        ? prev.filter(dt => dt !== deviceType)
        : [...prev, deviceType]
    );
  };

  const handleNext = () => {
    if (selectedStore) {
      setStep('deviceSelection');
    }
  };

  const handleBack = () => {
    setStep('storeSelection');
    setSelectedDeviceTypes([]); // Reset device types when going back
  };

  const handleExport = () => {
    if (selectedStore && selectedDeviceTypes.length > 0) {
      onConfirmExport(selectedStore, selectedDeviceTypes);
    }
  };

  const currentDeviceOptions = selectedStore === 'googlePlay' ? googlePlayDevices : appStoreDevices;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Export Artboards</DialogTitle>
          <DialogDescription>
            {step === 'storeSelection'
              ? "Select the target app store for your screenshots."
              : `Select device types for ${selectedStore === 'googlePlay' ? 'Google Play Store' : 'Apple App Store'}.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'storeSelection' && (
          <div className="grid gap-4 py-4">
            <RadioGroup onValueChange={(value) => handleStoreSelect(value as TargetStore)} value={selectedStore || undefined}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="googlePlay" id="googlePlay" />
                <Label htmlFor="googlePlay">Google Play Store</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="appleAppStore" id="appleAppStore" />
                <Label htmlFor="appleAppStore">Apple App Store</Label>
              </div>
            </RadioGroup>
          </div>
        )}

        {step === 'deviceSelection' && selectedStore && (
          <div className="grid gap-4 py-4">
            <p className="text-sm font-medium">Select device types to export:</p>
            {currentDeviceOptions.map(deviceType => (
              <div key={deviceType} className="flex items-center space-x-2">
                <Checkbox
                  id={deviceType}
                  checked={selectedDeviceTypes.includes(deviceType)}
                  onCheckedChange={() => handleDeviceTypeToggle(deviceType)}
                />
                <Label htmlFor={deviceType}>{deviceType}</Label>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {step === 'storeSelection' && (
            <>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleNext} disabled={!selectedStore}>Next</Button>
            </>
          )}
          {step === 'deviceSelection' && (
            <>
              <Button variant="outline" onClick={handleBack}>Back</Button>
              <Button onClick={handleExport} disabled={selectedDeviceTypes.length === 0}>Export</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
