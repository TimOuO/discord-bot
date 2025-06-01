import axios from "axios";
import { config } from "../config";

// Spotify API 授權相關變數
let accessToken: string | null = null;
let tokenExpiry: number = 0;

// 檢查是否有必要的 Spotify 授權資訊
const hasSpotifyCredentials = (): boolean => {
  return !!config.spotify.clientId && !!config.spotify.clientSecret;
};

// 獲取 Spotify 訪問令牌
const getAccessToken = async (): Promise<string> => {
  // 如果已有有效令牌，直接返回
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken as string;
  }

  if (!hasSpotifyCredentials()) {
    throw new Error(
      "缺少 Spotify API 憑證，請設置 SPOTIFY_CLIENT_ID 和 SPOTIFY_CLIENT_SECRET"
    );
  }
  try {
    const clientId = config.spotify.clientId;
    const clientSecret = config.spotify.clientSecret;

    if (!clientId || !clientSecret) {
      throw new Error("缺少 Spotify API 憑證");
    }

    // 使用客戶端憑證方式獲取令牌
    const response = await axios({
      method: "post",
      url: "https://accounts.spotify.com/api/token",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString("base64")}`,
      },
      data: "grant_type=client_credentials",
    });
    accessToken = response.data.access_token;
    // 設置令牌過期時間（通常為 1 小時）
    tokenExpiry = Date.now() + response.data.expires_in * 1000;
    return accessToken as string;
  } catch (error) {
    console.error("獲取 Spotify 訪問令牌失敗:", error);
    throw new Error("無法獲取 Spotify 授權");
  }
};

// 從 Spotify API 獲取曲目詳細信息，包括預覽 URL
export async function getTrackDetails(trackId: string): Promise<{
  title: string;
  artist: string;
  previewUrl: string | null;
  imageUrl: string;
}> {
  try {
    if (hasSpotifyCredentials()) {
      // 使用 Spotify API 獲取完整信息
      const token = await getAccessToken();
      const response = await axios.get(
        `https://api.spotify.com/v1/tracks/${trackId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = response.data;
      return {
        title: data.name,
        artist: data.artists.map((artist: any) => artist.name).join(", "),
        previewUrl: data.preview_url,
        imageUrl: data.album.images[0]?.url || "",
      };
    } else {
      // 回退到 OEmbed API
      const response = await axios.get(
        `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`
      );

      return {
        title: response.data.title,
        artist: "", // OEmbed 不提供單獨的藝術家字段
        previewUrl: null,
        imageUrl: response.data.thumbnail_url || "",
      };
    }
  } catch (error) {
    console.error("獲取 Spotify 曲目詳細信息失敗:", error);
    throw new Error("無法獲取曲目信息");
  }
}

// 解析 Spotify URL 獲取曲目 ID
export function extractSpotifyTrackId(url: string): string | null {
  // 支援格式：
  // - https://open.spotify.com/track/1234567890
  // - https://open.spotify.com/track/1234567890?si=1234
  // - spotify:track:1234567890
  const patterns = [
    /spotify\.com\/track\/([a-zA-Z0-9]+)(\?|$)/,
    /spotify:track:([a-zA-Z0-9]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}
