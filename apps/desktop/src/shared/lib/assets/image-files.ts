const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "bmp",
  "tif",
  "tiff",
  "ico"
]);

type FileListLike = ArrayLike<File> | File[];

type DataTransferItemLike = {
  kind?: string;
  type?: string;
  getAsFile?: () => File | null;
};

type ClipboardLike = {
  files?: FileListLike | null;
  items?: ArrayLike<DataTransferItemLike> | null;
};

const toArray = <T>(value: ArrayLike<T> | T[] | null | undefined) =>
  value ? Array.from(value) : [];

export const isImageFile = (file: File) => {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
};

export const extractImageFilesFromDataTransfer = (
  dataTransfer: Pick<DataTransfer, "files"> | ClipboardLike | null | undefined
) => toArray(dataTransfer?.files).filter(isImageFile);

export const extractImageFilesFromClipboardData = (
  clipboardData: Pick<DataTransfer, "files" | "items"> | ClipboardLike | null | undefined
) => {
  const files = extractImageFilesFromDataTransfer(clipboardData);
  if (files.length > 0) return files;
  return toArray(clipboardData?.items)
    .filter((item) => item?.kind === "file" && item.type?.startsWith("image/"))
    .map((item) => item.getAsFile?.())
    .filter((file): file is File => Boolean(file) && isImageFile(file));
};
