import boto3
from botocore.config import Config as BotoConfig

from common import get_logger
from ..config import settings

logger = get_logger("s3-client")


class S3Client:
    """S3/MinIO client wrapper for document storage."""

    def __init__(self):
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=BotoConfig(signature_version="s3v4"),
        )
        self.bucket = settings.s3_bucket

    async def upload(self, key: str, data: bytes, content_type: str = "application/octet-stream"):
        """Upload a file to S3."""
        logger.info("s3_upload", key=key, size=len(data))
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    async def download(self, key: str) -> bytes:
        """Download a file from S3."""
        logger.info("s3_download", key=key)
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        return response["Body"].read()

    async def delete(self, key: str):
        """Delete a file from S3."""
        logger.info("s3_delete", key=key)
        self.client.delete_object(Bucket=self.bucket, Key=key)

    async def ensure_bucket(self):
        """Create the bucket if it doesn't exist."""
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception:
            self.client.create_bucket(Bucket=self.bucket)
            logger.info("s3_bucket_created", bucket=self.bucket)
