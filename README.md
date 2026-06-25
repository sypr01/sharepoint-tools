# sharepoint-tools

Scripts de Python para interactuar con SharePoint usando la API de Microsoft Graph.

## Requisitos

- Python 3.9+
- Una cuenta de Microsoft 365 con acceso a SharePoint

## Instalación

```bash
pip install -r requirements.txt
```

## Uso

```python
from sharepoint_client import SharePointClient

client = SharePointClient(site_url="https://tuempresa.sharepoint.com/sites/tuSitio")
files = client.list_files(folder="/Documentos")
print(files)
```

## Contribuir

1. Haz fork del repositorio
2. Crea una rama: `git checkout -b mi-mejora`
3. Abre un Pull Request

## Licencia

MIT License — libre para usar, modificar y distribuir.
