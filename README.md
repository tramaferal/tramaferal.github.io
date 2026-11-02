# TramaFeral — Fase 1

Organizador visual de proyectos con Post-it conectables. Sin dependencias ni instalación.

## Cómo abrirlo
Haz doble clic en `index.html`. Se abre en Chrome o Edge, funciona sin internet y guarda todo
automáticamente en el navegador (IndexedDB).

> Usa siempre el mismo navegador y la misma ubicación de la carpeta: los datos quedan
> asociados a ese navegador y a esa ruta. No abras el archivo en modo incógnito.

## Uso
### Notas
| Acción | Cómo |
|---|---|
| Nueva nota | `Ctrl + S`: sin nada seleccionado aparece donde está el cursor |
| Nueva nota encadenada | `Ctrl + S` con una nota seleccionada: se crea a su derecha con flecha. Si esa nota ya iba hacia otra, la nueva queda en medio (como `Alt + S` en Resolve) |
| Nota en medio de una flecha | Selecciona la flecha y `Ctrl + S` |
| En el título | `Enter` guarda y cierra · `Ctrl + Enter` pasa al texto |
| En el texto | `Enter` = nueva línea · `Ctrl + Enter` o `Esc` guarda y cierra |
| Clasificar | En el editor, elige un color: Conflicto (rojo), Dato (azul), Testimonio (verde), Personaje (violeta), Rumor (amarillo). La etiqueta aparece arriba a la derecha de la nota. El gris es "Sin clasificar" y no muestra etiqueta |
| Editar nota | Doble clic, o seleccionarla y pulsar `Enter` |
| Mover / redimensionar | Arrastrar la nota / su borde derecho, inferior o esquina |
| Borrar nota(s) | `Supr` (pide confirmación). Si estaba en medio de una cadena, lo anterior se une con lo siguiente |

### Selección, portapapeles y deshacer
| Acción | Cómo |
|---|---|
| Seleccionar varias | `Ctrl + clic` en cada nota (otra vez la quita), o `Ctrl + arrastrar` en un espacio vacío para seleccionar por área |
| Mover varias | Arrastrar cualquiera de las seleccionadas |
| Cortar / copiar / pegar | `Ctrl + X` / `Ctrl + C` / `Ctrl + V`. Funciona con varias notas (se pegan con sus flechas internas) y entre proyectos. Con una sola nota y otra seleccionada, se pega a su derecha (o en medio); con una flecha seleccionada, en medio de la flecha |
| Deshacer / rehacer | `Ctrl + Z` / `Ctrl + Shift + Z` (o `Ctrl + Y`). Cada tablero tiene su propio historial (últimos 100 pasos, mientras la app está abierta) |

### Super nodos (mesas dentro de mesas)
| Acción | Cómo |
|---|---|
| Crear | Selecciona 2 o más notas y pulsa `Ctrl + A`. Se meten en un tablero nuevo, conectadas como estaban, y se abre el editor para ponerle nombre. Las flechas que venían de fuera pasan a apuntar al super nodo |
| Entrar | Clic en el super nodo (o en "Abrir ›", o en su subcarpeta del panel izquierdo). Arrastrarlo lo mueve sin entrar |
| Volver | `Ctrl + Q`, o clic en la ruta de arriba a la izquierda |
| Editar nombre y texto | `Ctrl + clic` en el super nodo, o doble clic en su subcarpeta del panel (solo nombre) |
| Seleccionarlo sin entrar | Arrastrarlo un poco, o `Ctrl + arrastrar` en vacío a su alrededor |
| Anidar | Dentro de un super nodo puedes crear otros super nodos |

### Conexiones y lienzo
| Acción | Cómo |
|---|---|
| Conectar | Arrastrar desde un punto (○) de una nota hasta otra nota |
| Reconectar una flecha | Agarrarla cerca del extremo que quieres soltar y arrastrarla a otra nota |
| Desconectar una flecha | Arrastrarla y soltarla en vacío, o clic en ella y `Supr` / `Retroceso` |
| Insertar una nota en una flecha | Arrastrar una nota suelta sobre la flecha (se ilumina) y soltar |
| Sacar una nota de una cadena | `Shift` + arrastrar la nota |
| Desplazar / zoom / ver todo | Arrastrar el fondo o botón central / rueda / `F` o "Ajustar" |
| Proyectos | `+` nuevo · doble clic renombrar · ✕ borrar (siempre pregunta) |
| Cancelar / deseleccionar | `Esc` |

## Estructura
```
index.html        estructura de la interfaz
css/styles.css    estilos
js/db.js          almacenamiento (IndexedDB; si no está disponible, localStorage)
js/app.js         proyectos, lienzo, notas, conexiones, editor y atajos
```
