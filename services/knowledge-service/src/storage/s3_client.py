import asyncio
from functools import partial

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from common import get_logger
from ..config import settings

logger = get_logger("s3-client")


class S3Client:
    """S3/MinIO client wrapper for document storage.

    Uses boto3 in a thread executor for async compatibility since
    boto3 is synchronous.
    """

    def __init__(self):
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name="us-east-1",
            config=BotoConfig(
                signature_version="s3v4",
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )
        self.bucket = settings.s3_bucket

    async def _run_sync(self, func, *args, **kwargs):
        """Run a synchronous boto3 call in a thread executor."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, partial(func, *args, **kwargs))

    async def upload(self, key: str, data: bytes, content_type: str = "application/octet-stream"):
        """Upload a file to S3/MinIO."""
        logger.info("s3_upload", key=key, size=len(data))
        await self._run_sync(
            self.client.put_object,
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    async def download(self, key: str) -> bytes:
        """Download a file from S3/MinIO."""
        logger.info("s3_download", key=key)
        response = await self._run_sync(
            self.client.get_object,
            Bucket=self.bucket,
            Key=key,
        )
        # Read the body in a thread as well
        loop = asyncio.get_event_loop()
        body = await loop.run_in_executor(None, response["Body"].read)
        return body

    async def delete(self, key: str):
        """Delete a file from S3/MinIO."""
        logger.info("s3_delete", key=key)
        await self._run_sync(
            self.client.delete_object,
            Bucket=self.bucket,
            Key=key,
        )

    async def exists(self, key: str) -> bool:
        """Check if a file exists in S3."""
        try:
            await self._run_sync(
                self.client.head_object,
                Bucket=self.bucket,
                Key=key,
            )
            return True
        except ClientError:
            return False

    async def ensure_bucket(self):
        """Create the bucket if it doesn't exist."""
        try:
            await self._run_sync(self.client.head_bucket, Bucket=self.bucket)
            logger.info("s3_bucket_exists", bucket=self.bucket)
        except ClientError:
            try:
                await self._run_sync(self.client.create_bucket, Bucket=self.bucket)
                logger.info("s3_bucket_created", bucket=self.bucket)
            except ClientError as e:
                logger.error("s3_bucket_create_failed", bucket=self.bucket, error=str(e))
                raise

    async def list_objects(self, prefix: str = "") -> list[dict]:
        """List objects in the bucket with an optional prefix."""
        response = await self._run_sync(
            self.client.list_objects_v2,
            Bucket=self.bucket,
            Prefix=prefix,
        )
        return [
            {"key": obj["Key"], "size": obj["Size"], "last_modified": obj["LastModified"].isoformat()}
            for obj in response.get("Contents", [])
        ]
