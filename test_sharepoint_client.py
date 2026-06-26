import unittest
from unittest.mock import MagicMock, patch
from sharepoint_client import SharePointClient


class TestSharePointClient(unittest.TestCase):

    def _make_client(self):
        with patch("sharepoint_client.msal.ConfidentialClientApplication") as mock_msal:
            mock_msal.return_value.acquire_token_for_client.return_value = {
                "access_token": "token-de-prueba"
            }
            return SharePointClient(
                tenant_id="tenant-123",
                client_id="client-123",
                client_secret="secret-123",
                site_url="https://empresa.sharepoint.com/sites/sitio",
            )

    def test_token_se_obtiene_al_inicializar(self):
        client = self._make_client()
        self.assertEqual(client._token, "token-de-prueba")

    def test_token_invalido_lanza_error(self):
        with patch("sharepoint_client.msal.ConfidentialClientApplication") as mock_msal:
            mock_msal.return_value.acquire_token_for_client.return_value = {
                "error": "invalid_client",
                "error_description": "Credenciales inválidas",
            }
            with self.assertRaises(ValueError):
                SharePointClient("t", "c", "s", "https://empresa.sharepoint.com")

    @patch("sharepoint_client.requests.get")
    def test_list_files_retorna_lista(self, mock_get):
        client = self._make_client()
        mock_get.return_value.json.return_value = {
            "value": [
                {"name": "archivo1.docx", "size": 1024},
                {"name": "archivo2.xlsx", "size": 2048},
            ]
        }
        mock_get.return_value.raise_for_status = MagicMock()

        archivos = client.list_files(site_id="site-123", folder_path="/")

        self.assertEqual(len(archivos), 2)
        self.assertEqual(archivos[0]["name"], "archivo1.docx")

    @patch("sharepoint_client.requests.get")
    def test_download_file_retorna_bytes(self, mock_get):
        client = self._make_client()
        mock_get.return_value.content = b"contenido del archivo"
        mock_get.return_value.raise_for_status = MagicMock()

        contenido = client.download_file(site_id="site-123", file_path="/archivo.docx")

        self.assertEqual(contenido, b"contenido del archivo")

    @patch("sharepoint_client.requests.put")
    def test_upload_file_retorna_metadata(self, mock_put):
        client = self._make_client()
        mock_put.return_value.json.return_value = {"name": "nuevo.txt", "size": 100}
        mock_put.return_value.raise_for_status = MagicMock()

        resultado = client.upload_file(
            site_id="site-123",
            folder_path="/",
            filename="nuevo.txt",
            content=b"contenido",
        )

        self.assertEqual(resultado["name"], "nuevo.txt")


if __name__ == "__main__":
    unittest.main()
