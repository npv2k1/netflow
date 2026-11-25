'use client';

import React from 'react';
import {
  ArrowLeftRight,
  Cable,
  Cctv,
  Compass,
  Globe,
  HardDrive,
  Hash,
  Laptop,
  Lock,
  Monitor,
  Network,
  Printer,
  Router,
  Scale,
  Server,
  ShieldCheck,
  Smartphone,
  Wifi,
} from 'lucide-react';
import { DeviceType } from '@/lib/network/types';

interface DeviceIconProps {
  type: DeviceType;
  className?: string;
  strokeWidth?: number;
}

export function DeviceIcon({
  type,
  className = 'w-5 h-5',
  strokeWidth = 1.9,
}: DeviceIconProps) {
  switch (type) {
    case 'internet':
      return <Globe className={className} strokeWidth={strokeWidth} />;
    case 'modem':
      return <Cable className={className} strokeWidth={strokeWidth} />;
    case 'gateway':
      return <ArrowLeftRight className={className} strokeWidth={strokeWidth} />;
    case 'firewall':
      return <ShieldCheck className={className} strokeWidth={strokeWidth} />;
    case 'vpn':
      return <Lock className={className} strokeWidth={strokeWidth} />;
    case 'router':
      return <Router className={className} strokeWidth={strokeWidth} />;
    case 'switch':
      return <Network className={className} strokeWidth={strokeWidth} />;
    case 'loadbalancer':
      return <Scale className={className} strokeWidth={strokeWidth} />;
    case 'ap':
      return <Wifi className={className} strokeWidth={strokeWidth} />;
    case 'pc':
      return <Monitor className={className} strokeWidth={strokeWidth} />;
    case 'laptop':
      return <Laptop className={className} strokeWidth={strokeWidth} />;
    case 'phone':
      return <Smartphone className={className} strokeWidth={strokeWidth} />;
    case 'printer':
      return <Printer className={className} strokeWidth={strokeWidth} />;
    case 'camera':
      return <Cctv className={className} strokeWidth={strokeWidth} />;
    case 'server':
      return <Server className={className} strokeWidth={strokeWidth} />;
    case 'dns':
      return <Compass className={className} strokeWidth={strokeWidth} />;
    case 'dhcp':
      return <Hash className={className} strokeWidth={strokeWidth} />;
    case 'nas':
      return <HardDrive className={className} strokeWidth={strokeWidth} />;
    default:
      return <Monitor className={className} strokeWidth={strokeWidth} />;
  }
}
