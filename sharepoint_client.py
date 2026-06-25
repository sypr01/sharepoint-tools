import requests
import msal


class SharePointClient:
    """Cliente para interactuar con SharePoint via Microsoft Graph API."""

    GRAPH_URL = "https://graph.microsoft.com/v1.0"

    def __init__(self, tenant_id: str, client_id: str, client_secret: str, site_url: str):
        self.site_url = site_url
        self._token = self._get_token(tenant_id, client_id, client_secret)

    def _get_token(self, tenant_id: str, client_id: str, client_secret: str) -> str:
        app = msal.ConfidentialClientApplication(
            client_id,
            authority=f"https://login.microsoftonline.com/{tenant_id}",
            client_credential=client_secret,
        )
        result = app.acquire_token_for_client(
            scopes=["https://graph.microsoft.com/.default"]
        )
        if "access_token" not in result:
            raise ValueError(f"Error al obtener token: {result.get('error_description')}")
        return result["access_token"]

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token}", "Accept": "application/json"}

    def list_files(self, site_id: str, folder_path: str = "/") -> list:
        """Lista los archivos de una carpeta en SharePoint."""
        url = f"{self.GRAPH_URL}/sites/{site_id}/drive/root:{folder_path}:/children"
        response = requests.get(url, headers=self._headers())
        response.raise_for_status()
        return response.json().get("value", [])

    def download_file(self, site_id: str, file_path: str) -> bytes:
        """Descarga el contenido de un archivo de SharePoint."""
        url = f"{self.GRAPH_URL}/sites/{site_id}/drive/root:{file_path}:/content"
        response = requests.get(url, headers=self._headers())
        response.raise_for_status()
        return response.content

    def upload_file(self, site_id: str, folder_path: str, filename: str, content: bytes) -> dict:
        """Sube un archivo a una carpeta de SharePoint."""
        url = f"{self.GRAPH_URL}/sites/{site_id}/drive/root:{folder_path}/{filename}:/content"
        headers = {**self._headers(), "Content-Type": "application/octet-stream"}
        response = requests.put(url, headers=headers, data=content)
        response.raise_for_status()
        return response.json()
