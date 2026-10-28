"""Run the native folder dialog on its own GUI main thread."""
import json
import sys
import tkinter as tk
from tkinter import filedialog

root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
try:
    folder = filedialog.askdirectory(parent=root, title='Escolha a pasta para seus downloads',
                                     initialdir=sys.argv[1] or None, mustexist=True)
    sys.stdout.buffer.write(json.dumps(folder, ensure_ascii=False).encode('utf-8'))
finally:
    root.destroy()
