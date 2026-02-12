/**
 * Barrel export for UI primitive components.
 *
 * Usage:
 *   import { UCard, UStatusPill, UInput, UTextArea } from "./components/ui";
 */

export { UCard } from "./UCard/UCard";
export type { UCardProps } from "./UCard/UCard";

export { UStatusPill } from "./UStatusPill/UStatusPill";
export type { UStatusPillProps } from "./UStatusPill/UStatusPill";

export { UInput } from "./UInput/UInput";
export type { UInputProps } from "./UInput/UInput";

export { UTextArea } from "./UTextArea/UTextArea";
export type { UTextAreaProps } from "./UTextArea/UTextArea";

export { UModal, UConfirmModal } from "./UModal/UModal";
export type { UModalProps, UConfirmModalProps } from "./UModal/UModal";

export { USkeleton } from "./USkeleton/USkeleton";
export type { USkeletonProps, USkeletonVariant } from "./USkeleton/USkeleton";

export { ULogViewer } from "./ui/ULogViewer";
export type { ULogViewerProps, ULogViewerHandle } from "./ui/ULogViewer";

export { RingBuffer } from "./ui/RingBuffer";

export { IpcErrorDetails } from "./ui/IpcErrorDetails";
export type { IpcErrorDetailsProps } from "./ui/IpcErrorDetails";

export { ErrorToast } from "./ui/ErrorToast";
export type { ErrorToastProps } from "./ui/ErrorToast";

export { UOptionCard, OTHER_OPTION_VALUE } from "./ui/UOptionCard";
export type { UOptionCardProps } from "./ui/UOptionCard";

export { UProgressHeader } from "./ui/UProgressHeader";
export type { UProgressHeaderProps } from "./ui/UProgressHeader";
