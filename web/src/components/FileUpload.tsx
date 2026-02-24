import { useState } from 'react';
import { Upload, message, Image, Button } from 'antd';
import {
  InboxOutlined,
  DeleteOutlined,
  AudioOutlined,
  VideoCameraOutlined,
  FileOutlined,
} from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';
import { uploadFile, getFileUrl } from '../api/upload';

const { Dragger } = Upload;

export interface AttachmentInfo {
  file_type: string; // image/audio/video
  file_name: string;
  file_path: string; // MinIO object key
  file_size: number;
}

interface FileUploadProps {
  value?: AttachmentInfo[];
  onChange?: (attachments: AttachmentInfo[]) => void;
}

export default function FileUpload({ value = [], onChange }: FileUploadProps) {
  const [uploading, setUploading] = useState(false);

  const handleRemove = (index: number) => {
    const newList = [...value];
    newList.splice(index, 1);
    onChange?.(newList);
  };

  const customUpload: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess, onError, onProgress } = options;
    setUploading(true);

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

      onChange?.([...value, attachment]);
      onSuccess?.(body.data);
      message.success(`${body.data.file_name} 上传成功`);
    } catch (err) {
      onError?.(err as Error);
      // Error already handled by request interceptor
    } finally {
      setUploading(false);
    }
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'audio':
        return <AudioOutlined style={{ fontSize: 24, color: '#1677ff' }} />;
      case 'video':
        return <VideoCameraOutlined style={{ fontSize: 24, color: '#52c41a' }} />;
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
        accept="image/*,audio/*,video/*"
        multiple
        showUploadList={false}
        customRequest={customUpload}
        disabled={uploading}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          {uploading ? '上传中...' : '点击或拖拽文件到此区域上传'}
        </p>
        <p className="ant-upload-hint">
          支持图片、音频、视频文件
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
                key={`${att.file_path}-${idx}`}
                style={{
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  padding: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  position: 'relative',
                }}
              >
                {att.file_type === 'image' ? (
                  <Image
                    src={getFileUrl(att.file_path)}
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
                    {getFileIcon(att.file_type)}
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
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => handleRemove(idx)}
                  style={{ position: 'absolute', top: 4, right: 4 }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
