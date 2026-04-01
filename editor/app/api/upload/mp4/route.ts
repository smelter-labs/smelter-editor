import { NextResponse, type NextRequest } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    const errorWithCode = error as Error & {
      code?: string;
      cause?: unknown;
    };
    return {
      message: error.message,
      code: errorWithCode.code,
      cause: errorWithCode.cause,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

export async function POST(req: NextRequest) {
  if (!BASE_URL) {
    console.error('[upload/mp4 proxy] missing SMELTER_EDITOR_SERVER_URL');
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  try {
    const headers = new Headers();
    const contentType = req.headers.get('content-type');
    const contentLength = req.headers.get('content-length');
    const upstreamUrl = `${BASE_URL}/upload/mp4`;

    console.log('[upload/mp4 proxy] forwarding request', {
      upstreamUrl,
      contentType,
      contentLength,
    });

    if (contentType) {
      headers.set('content-type', contentType);
    }

    if (contentLength) {
      headers.set('content-length', contentLength);
    }

    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      body: req.body,
      headers,
      // `duplex` is required when streaming a request body in Node.js.
      // @ts-expect-error `duplex` is supported at runtime but missing in typings.
      duplex: 'half',
    });

    const responseText = await upstream.text();
    const responseContentType = upstream.headers.get('content-type') ?? '';

    console.log('[upload/mp4 proxy] upstream response', {
      upstreamUrl,
      status: upstream.status,
      contentType: responseContentType,
    });

    let data: { error?: string; fileName?: string; folder?: string } = {};
    if (responseContentType.includes('application/json')) {
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch (error) {
        console.error('[upload/mp4 proxy] failed to parse upstream JSON', {
          upstreamUrl,
          responseText,
          parseError: getErrorDetails(error),
        });
        data = {
          error: responseText || 'Upstream returned invalid JSON',
        };
      }
    } else {
      data = {
        error:
          responseText ||
          `Upstream returned non-JSON response (${upstream.status})`,
      };
    }

    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    const details = getErrorDetails(error);
    console.error('[upload/mp4 proxy] failed', {
      upstreamUrl: `${BASE_URL}/upload/mp4`,
      contentType: req.headers.get('content-type'),
      contentLength: req.headers.get('content-length'),
      ...details,
    });
    return NextResponse.json({ error: details.message }, { status: 502 });
  }
}
