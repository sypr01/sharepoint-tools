import os
from sharepoint_client import SharePointClient

# Cargar credenciales desde variables de entorno
tenant_id = os.environ["TENANT_ID"]
client_id = os.environ["CLIENT_ID"]
client_secret = os.environ["CLIENT_SECRET"]
site_id = os.environ["SITE_ID"]

# Crear el cliente
client = SharePointClient(
    tenant_id=tenant_id,
    client_id=client_id,
    client_secret=client_secret,
    site_url=os.environ["SITE_URL"],
)

# Listar archivos de la carpeta raíz
print("Archivos en la carpeta raíz:")
archivos = client.list_files(site_id=site_id, folder_path="/")
for archivo in archivos:
    print(f"  - {archivo['name']} ({archivo.get('size', 0)} bytes)")

# Descargar un archivo
nombre_archivo = "documento.docx"
print(f"\nDescargando {nombre_archivo}...")
contenido = client.download_file(site_id=site_id, file_path=f"/{nombre_archivo}")
with open(nombre_archivo, "wb") as f:
    f.write(contenido)
print(f"Archivo guardado como {nombre_archivo}")

# Subir un archivo
print("\nSubiendo reporte.txt...")
with open("reporte.txt", "wb") as f:
    f.write(b"Este es un reporte de prueba.")
with open("reporte.txt", "rb") as f:
    resultado = client.upload_file(
        site_id=site_id,
        folder_path="/",
        filename="reporte.txt",
        content=f.read(),
    )
print(f"Archivo subido: {resultado['name']}")
