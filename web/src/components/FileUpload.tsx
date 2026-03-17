import { useState, useRef, useEffect } from 'react';
import { Upload, message, Button, Modal, Spin } from 'antd';
import {
  InboxOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  AudioOutlined,
  VideoCameraOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileZipOutlined,
} from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';
import { uploadFile, downloadFile, deleteUploadedFile } from '../api/upload';
import { useAuthUrl, AuthImage } from './AuthMedia';

const { Dragger } = Upload;

export interface AttachmentInfo {
  file_type: string; // image/audio/video/document/archive
  file_name: string;
  file_path: string; // MinIO object key
  file_size: number;
}

interface FileUploadProps {
  value?: AttachmentInfo[];
  onChange?: (attachments: AttachmentInfo[]) => void;
  /** Called after attachments change (upload or delete), to immediately persist to DB. */
  onSync?: (updatedAttachments: AttachmentInfo[]) => void;
}

/** File extensions that can be previewed in the browser. */
const previewableExts = new Set([
  'mp4', 'webm',              // video (mov excluded — poor non-Safari support)
  'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', // audio
  'pdf', 'txt', 'csv',        // iframe-renderable
]);

function canPreview(att: AttachmentInfo): boolean {
  if (att.file_type === 'image') return false; // images use antd Image preview
  const ext = att.file_name.split('.').pop()?.toLowerCase() ?? '';
  return previewableExts.has(ext);
}

function getPreviewType(att: AttachmentInfo): 'video' | 'audio' | 'iframe' {
  if (att.file_type === 'video') return 'video';
  if (att.file_type === 'audio') return 'audio';
  return 'iframe';
}

export default function FileUpload({ value = [], onChange, onSync }: FileUploadProps) {
  const [uploadingCount, setUploadingCount] = useState(0);
  const [previewAtt, setPreviewAtt] = useState<AttachmentInfo | null>(null);

  // Ref tracks the latest attachment list to avoid stale closures in concurrent uploads.
  const listRef = useRef<AttachmentInfo[]>(value);
  useEffect(() => { listRef.current = value; }, [value]);

  // Serialize onSync calls so concurrent uploads always resolve in order.
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());
  const enqueueSync = (newList: AttachmentInfo[]) => {
    if (!onSync) return;
    syncChainRef.current = syncChainRef.current.then(async () => {
      try {
        await onSync(newList);
      } catch {
        message.warning('同步附件失败，请手动保存');
      }
    });
  };

  const handleRemove = async (index: number) => {
    const removed = listRef.current[index];
    if (!removed) return;

    if (onSync) {
      const newList = listRef.current.filter((_, i) => i !== index);
      try {
        await onSync(newList);
        listRef.current = newList;
        onChange?.(newList);
      } catch {
        message.error('删除附件失败，请重试');
      }
    } else {
      try {
        await deleteUploadedFile(removed.file_path);
        const newList = listRef.current.filter((_, i) => i !== index);
        listRef.current = newList;
        onChange?.(newList);
      } catch {
        message.error('删除文件失败，请重试');
      }
    }
  };

  const handleDownload = (att: AttachmentInfo) => {
    downloadFile(att.file_path, att.file_name).catch(() => {
      message.error('下载失败，请重试');
    });
  };

  const customUpload: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess, onError, onProgress } = options;
    setUploadingCount(c => c + 1);

    try {
      onProgress?.({ percent: 30 } as unknown as UploadFile);

      const res = await uploadFile(file as File);
      const body = res as unknown as {
        data: {
          file_path: string;
          file_name: string;
          file_size: number;
          file_type: string;
        };
      };

      onProgress?.({ percent: 100 } as unknown as UploadFile);

      const attachment: AttachmentInfo = {
        file_type: body.data.file_type,
        file_name: body.data.file_name,
        file_path: body.data.file_path,
        file_size: body.data.file_size,
      };

      const newList = [...listRef.current, attachment];
      listRef.current = newList;
      onChange?.(newList);
      enqueueSync(newList);
      onSuccess?.(body.data);
      message.success(`${body.data.file_name} 上传成功`);
    } catch (err) {
      onError?.(err as Error);
    } finally {
      setUploadingCount(c => c - 1);
    }
  };

  const getFileIcon = (fileType: string, fileName?: string) => {
    switch (fileType) {
      case 'audio':
        return <AudioOutlined style={{ fontSize: 24, color: '#1677ff' }} />;
      case 'video':
        return <VideoCameraOutlined style={{ fontSize: 24, color: '#52c41a' }} />;
      case 'document': {
        const ext = fileName?.split('.').pop()?.toLowerCase();
        if (ext === 'pdf') return <FilePdfOutlined style={{ fontSize: 24, color: '#ff4d4f' }} />;
        if (ext === 'doc' || ext === 'docx') return <FileWordOutlined style={{ fontSize: 24, color: '#1677ff' }} />;
        if (ext === 'xls' || ext === 'xlsx') return <FileExcelOutlined style={{ fontSize: 24, color: '#52c41a' }} />;
        if (ext === 'ppt' || ext === 'pptx') return <FilePptOutlined style={{ fontSize: 24, color: '#fa8c16' }} />;
        return <FileTextOutlined style={{ fontSize: 24, color: '#8c8c8c' }} />;
      }
      case 'archive':
        return <FileZipOutlined style={{ fontSize: 24, color: '#722ed1' }} />;
      default:
        return <FileOutlined style={{ fontSize: 24 }} />;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      <Dragger
        accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.zip,.rar,.7z,.gz,.tar"
        multiple
        showUploadList={false}
        customRequest={customUpload}
        disabled={uploadingCount > 0}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          {uploadingCount > 0 ? '上传中...' : '点击或拖拽文件到此区域上传'}
        </p>
        <p className="ant-upload-hint">
          支持图片、音频、视频、文档、压缩包
        </p>
      </Dragger>

      {value.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            {value.map((att, idx) => (
              <div
                key={att.file_path}
                style={{
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  padding: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  position: 'relative',
                  cursor: !canPreview(att) && att.file_type !== 'image' ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (!canPreview(att) && att.file_type !== 'image') {
                    handleDownload(att);
                  }
                }}
              >
                {att.file_type === 'image' ? (
                  <AuthImage
                    fileKey={att.file_path}
                    alt={att.file_name}
                    width={180}
                    height={120}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                    fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/+F/PQAJpAN42sFkQAAAAABJRU5ErkJggg=="
                  />
                ) : (
                  <div
                    style={{
                      width: 180,
                      height: 120,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#fafafa',
                      borderRadius: 4,
                    }}
                  >
                    {getFileIcon(att.file_type, att.file_name)}
                  </div>
                )}
                <div
                  style={{
                    width: '100%',
                    textAlign: 'center',
                    fontSize: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={att.file_name}
                >
                  {att.file_name}
                </div>
                <div style={{ fontSize: 11, color: '#999' }}>
                  {formatFileSize(att.file_size)}
                </div>

                {/* Action buttons — top-right corner */}
                <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 2 }}>
                  {canPreview(att) && (
                    <Button
                      type="text"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={(e) => { e.stopPropagation(); setPreviewAtt(att); }}
                      title="预览"
                    />
                  )}
                  <Button
                    type="text"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={(e) => { e.stopPropagation(); handleDownload(att); }}
                    title="下载"
                  />
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={(e) => { e.stopPropagation(); handleRemove(idx); }}
                    title="删除"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewAtt && (
        <PreviewModal
          att={previewAtt}
          onClose={() => setPreviewAtt(null)}
          onDownload={handleDownload}
        />
      )}
    </div>
  );
}

/** Preview Modal that loads content via authenticated blob URL. */
function PreviewModal({ att, onClose, onDownload }: {
  att: AttachmentInfo;
  onClose: () => void;
  onDownload: (att: AttachmentInfo) => void;
}) {
  const blobUrl = useAuthUrl(att.file_path);
  const type = getPreviewType(att);

  const renderContent = () => {
    if (!blobUrl) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
          <Spin tip="加载中..." />
        </div>
      );
    }

    switch (type) {
      case 'video':
        return (
          <video
            controls
            autoPlay
            style={{ width: '100%', maxHeight: '70vh' }}
            src={blobUrl}
          />
        );
      case 'audio':
        return (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <audio controls autoPlay src={blobUrl} />
          </div>
        );
      case 'iframe':
        return (
          <iframe
            src={blobUrl}
            sandbox="allow-scripts"
            style={{ width: '100%', height: '70vh', border: 'none' }}
            title={att.file_name}
          />
        );
    }
  };

  return (
    <Modal
      open
      title={att.file_name}
      onCancel={onClose}
      width="80vw"
      style={{ maxWidth: 1200, top: 20 }}
      footer={
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={() => onDownload(att)}
        >
          下载
        </Button>
      }
      destroyOnClose
    >
      {renderContent()}
    </Modal>
  );
}
