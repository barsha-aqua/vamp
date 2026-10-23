
import cv2

# Try the first available camera
cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)

if not cap.isOpened():
    cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Camera not found. Check Camo Studio.")
    exit()

print("Camera connected! Press Q to quit.")

while True:
    success, frame = cap.read()

    if not success:
        print("Could not read camera frame.")
        break

    cv2.imshow("iPhone Camera - Gesture Project", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
